// HTTP слоят: пътищата на приложението, на касата и на управлението. Логиката е в core.js.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import * as core from './core.js';

const { AppError } = core;
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new AppError('bad_id', 'Невалиден номер.', 404);
  return n;
};

export async function buildApp({ db, config, sms, kasa }) {
  const app = Fastify({ logger: config.log ?? false, trustProxy: config.trustProxy ?? false, bodyLimit: 64 * 1024 });
  // CORS трябва само когато приложението се пуска в браузър; на телефона не се ползва
  if (config.corsOrigin) {
    await app.register(cors, { origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','), methods: ['GET', 'POST', 'PUT', 'DELETE'] });
  }
  await app.register(fastifyStatic, { root: fileURLToPath(new URL('../public', import.meta.url)), redirect: true });

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
  const opts = { pointsPerEuro: config.pointsPerEuro };

  app.get('/api/health', async () => ({ ok: true, demo: Boolean(config.demo), kasa: kasa.name }));

  // ---- вход на клиента ----
  app.post('/api/auth/request-code', async (req) => {
    const { phone, code } = core.requestCode(db, req.body?.phone, req.ip);
    await sms.send(phone, `Вашият код за клуб „Хора от Народа“ е ${code}. Важи 10 минути.`);
    // в демото няма истински SMS, затова кодът се връща, за да може да се влезе
    return config.demo ? { sent: true, demoCode: code } : { sent: true };
  });
  app.post('/api/auth/verify', async (req) => {
    const { token, customer, isNew } = core.verifyCode(db, req.body?.phone, req.body?.code, { cardPrefix: config.cardPrefix });
    return { token, isNew, me: core.customerSummary(db, customer.id, opts) };
  });
  app.post('/api/auth/logout', { preHandler: customerOnly }, async (req) => {
    core.dropSession(db, tokenOf(req));
    return { ok: true };
  });

  // ---- приложението ----
  app.get('/api/me', { preHandler: customerOnly }, async (req) => core.customerSummary(db, req.customerId, opts));
  app.put('/api/me', { preHandler: customerOnly }, async (req) => {
    core.setName(db, req.customerId, req.body?.name);
    return core.customerSummary(db, req.customerId, opts);
  });
  app.delete('/api/me', { preHandler: customerOnly }, async (req) => {
    core.deleteCustomer(db, req.customerId);
    return { ok: true };
  });

  app.get('/api/promotions', { preHandler: customerOnly }, async (req) => ({ promotions: core.listPromotions(db, req.customerId) }));
  app.post('/api/promotions/:id/activate', { preHandler: customerOnly }, async (req) => {
    core.activatePromotion(db, req.customerId, id(req.params.id));
    return { promotions: core.listPromotions(db, req.customerId) };
  });
  app.delete('/api/promotions/:id/activate', { preHandler: customerOnly }, async (req) => {
    core.deactivatePromotion(db, req.customerId, id(req.params.id));
    return { promotions: core.listPromotions(db, req.customerId) };
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
    return { purchase: result.purchase, points: core.balance(db, result.purchase.customer_id) };
  });

  const admin = { preHandler: staff('admin') };
  app.get('/api/admin/stats', admin, async () => core.adminStats(db));
  app.get('/api/admin/promotions', admin, async () => ({ promotions: core.adminListPromotions(db) }));
  app.post('/api/admin/promotions', admin, async (req) => core.adminSavePromotion(db, req.body || {}));
  app.put('/api/admin/promotions/:id', admin, async (req) => core.adminSavePromotion(db, req.body || {}, id(req.params.id)));
  app.get('/api/admin/rewards', admin, async () => ({ rewards: core.adminListRewards(db) }));
  app.post('/api/admin/rewards', admin, async (req) => core.adminSaveReward(db, req.body || {}));
  app.put('/api/admin/rewards/:id', admin, async (req) => core.adminSaveReward(db, req.body || {}, id(req.params.id)));
  app.get('/api/admin/customers', admin, async (req) => ({ customers: core.adminListCustomers(db, req.query?.q || '') }));

  return app;
}
