// HTTP пътищата за касовата програма Vamibex POS (/api/loyalty/v1/…) и управлението им. Логиката е в loyalty.js.
// Питащият е инсталация на каса (локалният ѝ конектор) със свой ключ: Authorization: Bearer <ключ>.
// Описанието за разработчика на касата е в docs/openapi-loyalty-v1.json и се дава и на /api/loyalty/v1/openapi.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as core from './core.js';
import * as loyalty from './loyalty.js';

const { AppError } = core;
const OPENAPI = fileURLToPath(new URL('../../docs/openapi-loyalty-v1.json', import.meta.url));

export function registerLoyaltyApi(app, { db, config, dbFor, staff }) {
  const cfg = {
    retailerCode: config.retailerCode ?? 'HORA', pointsPerEuro: config.pointsPerEuro, scratch: config.scratch ?? null, welcomePoints: config.welcomePoints ?? 0,
    earn: config.earn ?? {}, holdMinutes: config.holdMinutes ?? 15, quoteMinutes: config.quoteMinutes ?? 5,
  };
  const live = config.environment ?? 'production';

  // Ключовете на инсталациите са в основната база, независимо за коя среда е заявката.
  const source = async (req) => {
    const s = loyalty.sourceByToken(db, (req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!s) throw new AppError('unauthorized', 'Липсващ или невалиден ключ на инсталацията.', 401);
    req.sourceId = s.source_id;
  };
  /** Базата на средата от заявката (в тялото или в адреса); без посочена среда е тази, с която работи приложението. */
  const envDb = (req) => {
    const environment = req.body?.environment ?? req.query?.environment ?? live;
    const base = typeof environment === 'string' && loyalty.ENV_RE.test(environment) ? dbFor(environment) : null;
    if (!base) throw new AppError('unknown_environment', 'Непозната среда.', 400);
    return base;
  };
  const body = (req) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new AppError('bad_request', 'Заявката трябва да носи JSON обект.');
    return req.body;
  };
  const pos = { preHandler: source };
  /** Променящо действие с Idempotency-Key: повторението връща първия отговор. */
  const once = (req, reply, route, fn) => {
    const result = loyalty.idempotent(envDb(req), { sourceId: req.sourceId, key: req.headers['idempotency-key'], route, body: req.body ?? null }, fn);
    return reply.code(result.status).send(result.body);
  };

  app.get('/api/loyalty/v1/openapi.json', async (req, reply) => reply.type('application/json').send(readFileSync(OPENAPI, 'utf8')));

  // продажба с много редове е по-голяма от обичайната заявка, затова тук ограничението е 1 MB
  app.post('/api/loyalty/v1/events', { ...pos, bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const b = body(req);
    if (b.source_id !== req.sourceId) throw new AppError('source_mismatch', 'source_id не отговаря на ключа на инсталацията.', 403);
    if (typeof b.environment !== 'string') throw new AppError('unknown_environment', 'Липсва средата (environment).', 400);
    const result = loyalty.acceptEvent(envDb(req), { sourceId: req.sourceId, event: b.event }, cfg);
    loyalty.touchSource(db, req.sourceId, Number.isInteger(b.event?.sequence) ? b.event.sequence : null);
    // 202: събитието е прибрано за преглед, но не е приложено; конекторът продължава напред
    return reply.code(result.status === 'quarantined' ? 202 : 200).send(result);
  });

  app.post('/api/loyalty/v1/members/resolve', pos, async (req) => loyalty.resolveMember(envDb(req), body(req), cfg));
  app.post('/api/loyalty/v1/rewards/quote', pos, async (req) => loyalty.quoteRewards(envDb(req), body(req), cfg));

  app.post('/api/loyalty/v1/redemptions', pos, async (req, reply) => {
    const b = body(req);
    // без ключ повторена заявка би резервирала точките втори път
    if (!req.headers['idempotency-key']) throw new AppError('idempotency_key_required', 'За резервация е нужна заглавка Idempotency-Key.', 400);
    return once(req, reply, 'reserve', () => loyalty.reserveRedemption(envDb(req), req.sourceId, b, cfg));
  });
  app.post('/api/loyalty/v1/redemptions/:id/begin', pos, async (req, reply) => once(req, reply, `begin:${req.params.id}`, () => loyalty.beginRedemption(envDb(req), req.params.id, req.body ?? {})));
  app.post('/api/loyalty/v1/redemptions/:id/commit', pos, async (req, reply) => once(req, reply, `commit:${req.params.id}`, () => loyalty.commitRedemption(envDb(req), req.params.id, req.body ?? {})));
  app.post('/api/loyalty/v1/redemptions/:id/release', pos, async (req, reply) => once(req, reply, `release:${req.params.id}`, () => loyalty.releaseRedemption(envDb(req), req.params.id, req.body ?? {})));
  app.get('/api/loyalty/v1/redemptions/:id', pos, async (req) => loyalty.getRedemption(envDb(req), req.params.id));

  // ---- управление: инсталации на каси, получени събития, смяна на карта ----
  const admin = { preHandler: staff('admin') };
  app.get('/api/admin/pos-sources', admin, async () => ({ sources: loyalty.listSources(db), retailerCode: cfg.retailerCode, environment: live }));
  app.post('/api/admin/pos-sources', admin, async (req) => loyalty.createSource(db, req.body?.source_id, req.body?.note));
  app.post('/api/admin/pos-sources/:id/token', admin, async (req) => loyalty.rotateSourceToken(db, req.params.id));
  app.put('/api/admin/pos-sources/:id', admin, async (req) => {
    loyalty.setSourceActive(db, req.params.id, req.body?.active !== false && req.body?.active !== 0);
    return { sources: loyalty.listSources(db) };
  });
  app.get('/api/admin/pos-events', admin, async (req) => ({ events: loyalty.listEvents(envDb(req), { status: req.query?.status || null }) }));
  app.post('/api/admin/customers/:id/replace-card', admin, async (req) => {
    const c = core.replaceCard(db, Number(req.params.id) || 0, config.cardPrefix);
    return { id: c.id, cardCode: c.card_code, customerRef: c.customer_ref };
  });
}
