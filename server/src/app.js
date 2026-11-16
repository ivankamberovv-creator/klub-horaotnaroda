// HTTP слоят: пътищата на приложението, на касата и на управлението. Логиката е в core.js.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { saveImage } from './uploads.js';
import * as core from './core.js';

const { AppError } = core;
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new AppError('bad_id', 'Невалиден номер.', 404);
  return n;
};

export async function buildApp({ db, config, mail, kasa, weather = { at: async () => null } }) {
  const app = Fastify({ logger: config.log ?? false, trustProxy: config.trustProxy ?? false, bodyLimit: 64 * 1024 });
  // CORS трябва само когато приложението се пуска в браузър; на телефона не се ползва
  if (config.corsOrigin) {
    await app.register(cors, { origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','), methods: ['GET', 'POST', 'PUT', 'DELETE'] });
  }
  // Какво се сервира: страницата за служители на /admin/, качените снимки на /uploads/, а на / самото приложение
  // (готовият му уеб вариант в config.appDir). Ако още не е построено, на / стои кратка страница.
  const publicDir = fileURLToPath(new URL('../public', import.meta.url));
  await app.register(fastifyStatic, { root: join(publicDir, 'admin'), prefix: '/admin/', redirect: true });
  if (config.uploadDir) {
    await app.register(fastifyStatic, { root: config.uploadDir, prefix: '/uploads/', decorateReply: false, maxAge: '30d', immutable: true });
  }
  const appBuilt = Boolean(config.appDir) && existsSync(join(config.appDir, 'index.html'));
  await app.register(fastifyStatic, {
    root: appBuilt ? config.appDir : publicDir, prefix: '/', decorateReply: false,
    // страницата и работникът за работа без интернет не се пазят от браузъра, за да идват новите версии веднага
    setHeaders: (reply, path) => { if (/(index\.html|sw\.js|manifest\.json)$/.test(path)) reply.header('cache-control', 'no-cache'); },
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err.validation || err.statusCode === 400) return reply.code(400).send({ error: 'bad_request', message: 'Заявката не е вярна.' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'bad_request', message: 'Заявката не е вярна.' });
    req.log.error(err);
    console.error(err);
    return reply.code(500).send({ error: 'server', message: 'Нещо се обърка. Опитайте пак след малко.' });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'not_found', message: 'Няма такава страница.' }));

  // ---- кой пита ----
  const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  const customerOnly = async (req) => {
    const s = core.getSession(db, tokenOf(req));
    if (!s || s.role !== 'customer') throw new AppError('unauthorized', 'Влезте отново.', 401);
    req.customerId = s.customer_id;
  };
  const staff = (...roles) => async (req) => {
    const s = core.getSession(db, tokenOf(req));
    if (!s || !roles.includes(s.role)) throw new AppError('unauthorized', 'Влезте отново.', 401);
    req.role = s.role;
  };
  const opts = { pointsPerEuro: config.pointsPerEuro, scratch: config.scratch ?? null, welcomePoints: config.welcomePoints ?? 0,
    referralPoints: config.referralPoints ?? 0, referralMinCents: config.referralMinCents ?? 0 };
  /** Профилът на клиента; пътьом дава точките за рожден ден, ако днес му е денят */
  const me = (customerId) => {
    core.grantBirthdayBonus(db, customerId, config.birthdayPoints ?? 0);
    return core.customerSummary(db, customerId, opts);
  };

  app.get('/api/health', async () => ({ ok: true, demo: Boolean(config.demo), kasa: kasa.name }));

  // ---- вход на клиента ----
  app.post('/api/auth/request-code', async (req) => {
    const { email, code } = core.requestCode(db, req.body?.email, req.ip);
    try {
      await mail.send(email, `Код за вход: ${code}`,
        `Здравейте,\n\nВашият код за вход в клуб „Хора от Народа“ е ${code}.\nВажи 10 минути.\n\nАко не сте поискали код, не правете нищо: без него никой не може да влезе.\n`);
    } catch (err) {
      console.error('Писмото с кода не тръгна:', err.message);
      throw new AppError('mail_failed', 'Не успяхме да пратим писмото. Опитайте пак след малко.', 502);
    }
    // в демото писма не се пращат, затова кодът се връща, за да може да се влезе
    return config.demo ? { sent: true, demoCode: code } : { sent: true };
  });
  app.post('/api/auth/verify', async (req) => {
    const { token, customer, isNew } = core.verifyCode(db, req.body?.email, req.body?.code, { cardPrefix: config.cardPrefix });
    return { token, isNew, me: core.customerSummary(db, customer.id, opts) };
  });
  app.post('/api/auth/logout', { preHandler: customerOnly }, async (req) => {
    core.dropSession(db, tokenOf(req));
    return { ok: true };
  });

  // ---- покани ----
  app.get('/api/invite', { preHandler: customerOnly }, async (req) => core.inviteInfo(db, req.customerId, opts));
  app.post('/api/invite', { preHandler: customerOnly }, async (req) => core.acceptInvite(db, req.customerId, req.body?.code, opts));

  // времето при клиента: около любимия му магазин, иначе в града с най-много магазини
  const weatherFor = async (customerId) => {
    const place = core.weatherPlace(db, customerId);
    const now = place ? await weather.at(place.lat, place.lng) : null;
    return now ? { ...now, city: place.city, own: place.own } : null;
  };
  const weatherKind = async (customerId) => (await weatherFor(customerId))?.kind ?? null;

  // ---- приложението ----
  app.get('/api/me', { preHandler: customerOnly }, async (req) => me(req.customerId));
  app.get('/api/home', { preHandler: customerOnly }, async (req) => {
    core.grantBirthdayBonus(db, req.customerId, config.birthdayPoints ?? 0);
    return core.home(db, req.customerId, { ...opts, weather: await weatherFor(req.customerId) });
  });
  app.put('/api/me', { preHandler: customerOnly }, async (req) => {
    // сменя се само това, което е пратено: име, рожден ден (само веднъж) или любим магазин
    const b = req.body || {};
    if (b.name !== undefined) core.setName(db, req.customerId, b.name);
    if (b.birthday !== undefined) core.setBirthday(db, req.customerId, b.birthday);
    if (b.favoriteStoreId !== undefined) core.setFavoriteStore(db, req.customerId, b.favoriteStoreId === null ? null : id(b.favoriteStoreId));
    return core.customerSummary(db, req.customerId, opts);
  });
  app.delete('/api/me', { preHandler: customerOnly }, async (req) => {
    core.deleteCustomer(db, req.customerId);
    return { ok: true };
  });

  app.get('/api/promotions', { preHandler: customerOnly }, async (req) => ({ promotions: core.listPromotions(db, req.customerId, { weather: await weatherKind(req.customerId) }) }));
  app.post('/api/promotions/:id/activate', { preHandler: customerOnly }, async (req) => {
    const kind = await weatherKind(req.customerId);
    core.activatePromotion(db, req.customerId, id(req.params.id), { weather: kind });
    return { promotions: core.listPromotions(db, req.customerId, { weather: kind }) };
  });
  app.delete('/api/promotions/:id/activate', { preHandler: customerOnly }, async (req) => {
    core.deactivatePromotion(db, req.customerId, id(req.params.id));
    return { promotions: core.listPromotions(db, req.customerId, { weather: await weatherKind(req.customerId) }) };
  });

  app.get('/api/rewards', { preHandler: customerOnly }, async (req) => ({
    points: core.balance(db, req.customerId), rewards: core.listRewards(db), redemptions: core.listRedemptions(db, req.customerId),
  }));
  app.post('/api/rewards/:id/redeem', { preHandler: customerOnly }, async (req) => {
    const redemption = core.redeemReward(db, req.customerId, id(req.params.id));
    return { redemption, points: core.balance(db, req.customerId), redemptions: core.listRedemptions(db, req.customerId) };
  });

  app.get('/api/purchases', { preHandler: customerOnly }, async (req) => ({
    totals: core.purchaseTotals(db, req.customerId), purchases: core.listPurchases(db, req.customerId),
  }));
  app.get('/api/purchases/:id', { preHandler: customerOnly }, async (req) => core.getPurchase(db, req.customerId, id(req.params.id)));

  app.get('/api/scratch', { preHandler: customerOnly }, async (req) => ({ cards: core.listScratchCards(db, req.customerId) }));
  app.post('/api/scratch/:id/reveal', { preHandler: customerOnly }, async (req) => core.revealScratchCard(db, req.customerId, id(req.params.id)));
  app.get('/api/challenges', { preHandler: customerOnly }, async (req) => ({ challenges: core.listChallenges(db, req.customerId) }));
  app.get('/api/points-history', { preHandler: customerOnly }, async (req) => ({ points: core.balance(db, req.customerId), history: core.pointsHistory(db, req.customerId) }));
  app.get('/api/stores', { preHandler: customerOnly }, async () => ({ stores: core.listStores(db) }));
  app.get('/api/news', { preHandler: customerOnly }, async (req) => {
    const news = core.listNews(db);
    core.markNewsSeen(db, req.customerId); // отварянето на раздела брои новините за прочетени
    return { news };
  });

  // ---- служители: каса и управление ----
  app.post('/api/staff/login', async (req) => core.staffLogin(db, req.body?.password, config));

  app.get('/api/kasa/customer/:code', { preHandler: staff('kasa', 'admin') }, async (req) => ({
    ...core.kasaLookup(db, req.params.code), canSimulate: kasa.canSimulate, pointsPerEuro: config.pointsPerEuro,
  }));
  app.post('/api/kasa/redemptions/:id/issue', { preHandler: staff('kasa', 'admin') }, async (req) => core.resolveRedemption(db, id(req.params.id), 'issued'));
  app.post('/api/kasa/redemptions/:id/cancel', { preHandler: staff('kasa', 'admin') }, async (req) => core.resolveRedemption(db, id(req.params.id), 'cancelled'));
  // Пробна покупка: само при демо касата. При истинска касова програма покупките идват от нея.
  app.post('/api/kasa/demo-purchase', { preHandler: staff('kasa', 'admin') }, async (req) => {
    if (!kasa.canSimulate) throw new AppError('not_demo', 'Пробни покупки има само при демо касата.', 403);
    const b = req.body || {};
    const totalCents = Number(b.totalCents), discountCents = Number(b.discountCents ?? 0);
    if (!Number.isInteger(totalCents) || totalCents <= 0 || totalCents > 1_000_000) throw new AppError('bad_total', 'Въведете сумата на покупката.');
    if (!Number.isInteger(discountCents) || discountCents < 0) throw new AppError('bad_discount', 'Отстъпката не е вярна.');
    const result = core.recordPurchase(db, {
      source: 'demo', externalId: `demo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, cardCode: b.cardCode,
      shop: String(b.shop || 'Пробен магазин').slice(0, 80), totalCents, discountCents,
      items: Array.isArray(b.items) ? b.items.slice(0, 50).map((it) => ({ name: String(it.name).slice(0, 120), quantity: Number(it.quantity) || 1, totalCents: Number(it.totalCents) || 0 })) : [],
    }, opts);
    if (result.skipped) throw new AppError('no_customer', 'Няма клиент с такъв код.', 404);
    return { purchase: result.purchase, points: core.balance(db, result.purchase.customer_id), scratchCard: Boolean(result.scratchCard), completed: result.completed };
  });

  const admin = { preHandler: staff('admin') };
  app.get('/api/admin/stats', admin, async () => core.adminStats(db));
  app.get('/api/admin/promotions', admin, async () => ({ promotions: core.adminListPromotions(db) }));
  app.post('/api/admin/promotions', admin, async (req) => core.adminSavePromotion(db, req.body || {}));
  app.put('/api/admin/promotions/:id', admin, async (req) => core.adminSavePromotion(db, req.body || {}, id(req.params.id)));
  app.get('/api/admin/rewards', admin, async () => ({ rewards: core.adminListRewards(db) }));
  app.post('/api/admin/rewards', admin, async (req) => core.adminSaveReward(db, req.body || {}));
  app.put('/api/admin/rewards/:id', admin, async (req) => core.adminSaveReward(db, req.body || {}, id(req.params.id)));
  app.get('/api/admin/challenges', admin, async () => ({ challenges: core.adminListChallenges(db) }));
  app.post('/api/admin/challenges', admin, async (req) => core.adminSaveChallenge(db, req.body || {}));
  app.put('/api/admin/challenges/:id', admin, async (req) => core.adminSaveChallenge(db, req.body || {}, id(req.params.id)));
  app.get('/api/admin/stores', admin, async () => ({ stores: core.adminListStores(db) }));
  app.post('/api/admin/stores', admin, async (req) => core.adminSaveStore(db, req.body || {}));
  app.put('/api/admin/stores/:id', admin, async (req) => core.adminSaveStore(db, req.body || {}, id(req.params.id)));
  app.get('/api/admin/news', admin, async () => ({ news: core.adminListNews(db) }));
  app.post('/api/admin/news', admin, async (req) => core.adminSaveNews(db, req.body || {}));
  app.put('/api/admin/news/:id', admin, async (req) => core.adminSaveNews(db, req.body || {}, id(req.params.id)));
  // снимка за оферта или новина, пратена като base64; ограничението е по-голямо само за този път
  app.post('/api/admin/upload', { ...admin, bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    if (!config.uploadDir) throw new AppError('no_uploads', 'Качването на снимки не е настроено.', 500);
    return { url: saveImage(config.uploadDir, req.body?.data) };
  });
  app.get('/api/admin/customers', admin, async (req) => ({ customers: core.adminListCustomers(db, req.query?.q || '') }));

  return app;
}
