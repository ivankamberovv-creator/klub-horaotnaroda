// Награди на касата (Vamibex POS): оферта за кошницата, резервация, започване, потвърждаване и освобождаване.
// Най-важното: едни и същи точки не могат да се изхарчат два пъти, и повторена заявка не действа втори път.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core.js';
import * as loyalty from '../src/loyalty.js';
import { setup, sale } from './pos-pomosht.js';

/** Клиент със 100 точки и три награди: две с отстъпка за касата и една, която се дава на ръка */
async function withRewards(cfg) {
  const t = await setup(cfg);
  t.db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, 100, 'adjustment', 'proba', '2026-11-17')").run(t.me.me.id);
  const add = (title, cost, discount) => t.db.prepare('INSERT INTO rewards (title, cost_points, discount_cents, created_at) VALUES (?, ?, ?, ?)').run(title, cost, discount, '2026-11-17').lastInsertRowid;
  t.small = add('2 € отстъпка', 80, 200);
  t.big = add('10 € отстъпка', 400, 1000);
  t.byHand = add('Буркан мед', 50, 0);
  let k = 0;
  /** Заявка от каса; всяка получава свой Idempotency-Key, освен ако не е подаден */
  t.pos = (method, url, body, source = t.east, key = `k-${++k}`) => t.call(method, url, body, source.token, key ? { 'idempotency-key': key } : {});
  t.reserve = (over = {}, source = t.east, key) => t.pos('POST', '/api/loyalty/v1/redemptions',
    { retailer_code: 'HORA', customer_ref: t.ref, reward_id: t.small, sale_id: 'cart-1', revision: 3, store_code: 'EAST', register_code: 'POS-1', total_cents: 1020, ...over }, source, key);
  return t;
}

test('оферта за кошницата: само наградите, за които стигат точките и които не надхвърлят сумата', async () => {
  const t = await withRewards();
  const quote = (over = {}) => t.pos('POST', '/api/loyalty/v1/rewards/quote', { retailer_code: 'HORA', customer_ref: t.ref, sale_id: 'cart-1', revision: 3, store_code: 'EAST', register_code: 'POS-1',
    currency: 'EUR', total_cents: 1020, items: [{ sku: 'P-01', quantity: 2, total_cents: 240 }], ...over });
  const q = await quote();
  assert.equal(q.status, 200);
  assert.equal(q.body.balance_points, 100);
  assert.equal(q.body.customer_ref, t.ref);
  assert.equal(q.body.currency, 'EUR');
  // „10 € отстъпка“ иска 400 точки, „Буркан мед“ няма отстъпка за касата
  assert.deepEqual(q.body.rewards, [{ reward_id: t.small, title: '2 € отстъпка', description: '', points: 80, discount_cents: 200 }]);
  assert.ok(new Date(q.body.valid_until) > new Date());
  // кошница за 1,50 €: отстъпка от 2 € не се предлага
  assert.deepEqual((await quote({ total_cents: 150 })).body.rewards, []);
  assert.equal((await quote({ currency: 'BGN' })).status, 400);
  assert.equal((await quote({ customer_ref: 'L-NEPOZNAT' })).status, 404);
  assert.equal((await quote({ total_cents: -1 })).status, 400);
  // офертата не пипа точките
  assert.equal(t.points(), 100);
});

test('резервацията взима точките веднага; пълният път е резервация → започнато плащане → потвърждение', async () => {
  const t = await withRewards();
  const r = await t.reserve();
  assert.equal(r.status, 200);
  assert.match(r.body.redemption_id, /^rd_[0-9a-f]{24}$/);
  assert.deepEqual([r.body.status, r.body.reserved_points, r.body.discount_cents, r.body.customer_ref, r.body.sale_id], ['reserved', 80, 200, t.ref, 'cart-1']);
  assert.ok(new Date(r.body.expires_at) > new Date());
  assert.equal(t.points(), 20);
  const id = r.body.redemption_id;

  // потвърждение преди започнато плащане не се приема
  const early = await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/commit`, { sale_id: 'cart-1' });
  assert.deepEqual([early.status, early.body.error], [409, 'wrong_state']);

  const begun = await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/begin`, { sale_id: 'cart-1', revision: 4 });
  assert.deepEqual([begun.status, begun.body.status, begun.body.expires_at, begun.body.sale_revision], [200, 'begun', null, 4]);
  // повторено започване връща същото
  assert.equal((await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/begin`, {})).body.status, 'begun');

  const wrongSale = await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/commit`, { sale_id: 'cart-2' });
  assert.deepEqual([wrongSale.status, wrongSale.body.error], [409, 'sale_mismatch']);
  const done = await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/commit`, { sale_id: 'cart-1', event_id: 'sale.completed:cart-1' });
  assert.deepEqual([done.status, done.body.status, done.body.event_id], [200, 'committed', 'sale.completed:cart-1']);
  // повторено потвърждение връща същото; с друго събитие е грешка
  assert.equal((await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/commit`, { sale_id: 'cart-1', event_id: 'sale.completed:cart-1' })).body.status, 'committed');
  assert.equal((await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/commit`, { sale_id: 'cart-1', event_id: 'sale.completed:drugo' })).status, 409);
  // след потвърждение наградата не може да се върне
  assert.equal((await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/release`, {})).status, 409);
  assert.equal(t.points(), 20);

  const state = await t.call('GET', `/api/loyalty/v1/redemptions/${id}`, null, t.west.token);
  assert.deepEqual([state.status, state.body.status, state.body.reserved_points], [200, 'committed', 80]);
  assert.equal((await t.call('GET', '/api/loyalty/v1/redemptions/rd_nyama', null, t.east.token)).status, 404);
  assert.equal((await t.call('GET', `/api/loyalty/v1/redemptions/${id}`)).status, 401);
  // клиентът вижда наградата в историята на точките си
  const history = (await t.call('GET', '/api/points-history', null, t.me.token)).body.history;
  assert.deepEqual([history[0].label, history[0].delta], ['Награда: 2 € отстъпка', -80]);
});

test('едни и същи точки не се харчат едновременно в два магазина', async () => {
  const t = await withRewards(); // 100 точки, наградата струва 80
  const [a, b] = await Promise.all([t.reserve({ sale_id: 'cart-east' }, t.east), t.reserve({ sale_id: 'cart-west', store_code: 'WEST' }, t.west)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal([a, b].find((r) => r.status === 409).body.error, 'not_enough_points');
  assert.equal(t.points(), 20);
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM pos_redemptions WHERE status = 'reserved'").get().n, 1);
  // и за една кошница не може да има две действащи резервации
  t.db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, 500, 'adjustment', 'proba', '2026-11-17')").run(t.me.me.id);
  const won = [a, b].find((r) => r.status === 200);
  const second = await t.reserve({ sale_id: won.body.sale_id });
  assert.deepEqual([second.status, second.body.error], [409, 'sale_has_redemption']);
});

test('Idempotency-Key: повторена заявка връща първия отговор и не резервира втори път', async () => {
  const t = await withRewards();
  // без ключ резервация не се приема
  const noKey = await t.reserve({}, t.east, null);
  assert.deepEqual([noKey.status, noKey.body.error], [400, 'idempotency_key_required']);
  const first = await t.reserve({}, t.east, 'klyuch-1');
  const again = await t.reserve({}, t.east, 'klyuch-1');
  assert.equal(first.status, 200);
  assert.deepEqual(again.body, first.body);
  assert.equal(t.points(), 20);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM pos_redemptions').get().n, 1);
  // същият ключ с други данни е грешка, а не нова резервация
  const other = await t.reserve({ sale_id: 'cart-2' }, t.east, 'klyuch-1');
  assert.deepEqual([other.status, other.body.error], [422, 'idempotency_mismatch']);
  // и отказът се помни: след като точките се появят, същият ключ пак връща първия отказ
  const poor = await t.reserve({ reward_id: t.big, sale_id: 'cart-3' }, t.east, 'klyuch-2');
  assert.deepEqual([poor.status, poor.body.error], [409, 'not_enough_points']);
  t.db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, 1000, 'adjustment', 'proba', '2026-11-17')").run(t.me.me.id);
  assert.equal((await t.reserve({ reward_id: t.big, sale_id: 'cart-3' }, t.east, 'klyuch-2')).status, 409);
  assert.equal((await t.reserve({ reward_id: t.big, sale_id: 'cart-3' }, t.east, 'klyuch-3')).status, 200);
  // ключовете са на инсталация: същият ключ от друга каса е отделна заявка
  const west = await t.reserve({ sale_id: 'cart-4' }, t.west, 'klyuch-1');
  assert.equal(west.status, 200);
  assert.notEqual(west.body.redemption_id, first.body.redemption_id);
  const bad = await t.reserve({}, t.east, 'ключ с интервал');
  assert.equal(bad.status, 400);
});

test('освобождаване връща точките; работи и след започнато плащане, когато касата докаже отказа', async () => {
  const t = await withRewards();
  const a = (await t.reserve({ sale_id: 'cart-a' })).body.redemption_id;
  const released = await t.pos('POST', `/api/loyalty/v1/redemptions/${a}/release`, { reason: 'клиентът се отказа' });
  assert.deepEqual([released.status, released.body.status], [200, 'released']);
  assert.equal(t.points(), 100);
  // повторено освобождаване не връща точките втори път
  assert.equal((await t.pos('POST', `/api/loyalty/v1/redemptions/${a}/release`, {})).body.status, 'released');
  assert.equal(t.points(), 100);
  assert.equal((await t.pos('POST', `/api/loyalty/v1/redemptions/${a}/begin`, {})).status, 409);

  const b = (await t.reserve({ sale_id: 'cart-b' })).body.redemption_id;
  await t.pos('POST', `/api/loyalty/v1/redemptions/${b}/begin`, {});
  assert.equal(t.points(), 20);
  assert.equal((await t.pos('POST', `/api/loyalty/v1/redemptions/${b}/release`, { reason: 'плащането е отказано' })).body.status, 'released');
  assert.equal(t.points(), 100);
  const history = (await t.call('GET', '/api/points-history', null, t.me.token)).body.history;
  assert.deepEqual([history[0].label, history[0].delta], ['Върнати точки: 2 € отстъпка', 80]);
});

test('резервация без започнато плащане изтича и връща точките; започнатото плащане не изтича само', async () => {
  const t = await withRewards({ holdMinutes: 15 });
  const waiting = (await t.reserve({ sale_id: 'cart-chaka' })).body.redemption_id;
  t.db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, 80, 'adjustment', 'proba', '2026-11-17')").run(t.me.me.id);
  const begun = (await t.reserve({ sale_id: 'cart-plashta' })).body.redemption_id;
  await t.pos('POST', `/api/loyalty/v1/redemptions/${begun}/begin`, {});
  assert.equal(t.points(), 20);
  // минали са часове
  t.db.prepare("UPDATE pos_redemptions SET expires_at = '2026-01-01T00:00:00.000Z'").run();
  t.app.expireReservations();
  assert.equal((await t.call('GET', `/api/loyalty/v1/redemptions/${waiting}`, null, t.east.token)).body.status, 'expired');
  // неизвестният резултат остава резервиран до сверяване
  assert.equal((await t.call('GET', `/api/loyalty/v1/redemptions/${begun}`, null, t.east.token)).body.status, 'begun');
  assert.equal(t.points(), 100);
  // изтеклата не може да се започне, а освобождаването ѝ не връща точките втори път
  assert.equal((await t.pos('POST', `/api/loyalty/v1/redemptions/${waiting}/begin`, {})).status, 409);
  assert.equal((await t.pos('POST', `/api/loyalty/v1/redemptions/${waiting}/release`, {})).body.status, 'expired');
  assert.equal(t.points(), 100);
  assert.equal(loyalty.expireReservations(t.db), 0);
});

test('сверяване след прекъсване: когато продажбата пристигне, започнатата награда приключва сама', async () => {
  const t = await withRewards();
  const id = (await t.reserve({ sale_id: 'cart-prekasnat' })).body.redemption_id;
  await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/begin`, {});
  // касата е изгубила връзка преди потвърждението; после конекторът носи продажбата
  const event = sale(t.ref, {}, { sale_id: 'cart-prekasnat', total_cents: 820 });
  assert.equal((await t.send(event)).body.points, 8);
  const state = await t.call('GET', `/api/loyalty/v1/redemptions/${id}`, null, t.east.token);
  assert.deepEqual([state.body.status, state.body.event_id], ['committed', event.id]);
  assert.equal(t.points(), 28);
  // закъснялото потвърждение от касата връща същото
  const late = await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/commit`, { sale_id: 'cart-prekasnat', event_id: event.id });
  assert.deepEqual([late.status, late.body.status], [200, 'committed']);
  // само резервирана (без започнато плащане) награда не се приключва от продажбата: не се знае дали отстъпката е приложена
  t.db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, 100, 'adjustment', 'proba', '2026-11-17')").run(t.me.me.id);
  const loose = (await t.reserve({ sale_id: 'cart-bez-begin' })).body.redemption_id;
  await t.send(sale(t.ref, {}, { sale_id: 'cart-bez-begin' }));
  assert.equal((await t.call('GET', `/api/loyalty/v1/redemptions/${loose}`, null, t.east.token)).body.status, 'reserved');
});

test('пълно връщане на покупка с осребрена награда връща и точките за наградата', async () => {
  const t = await withRewards();
  const id = (await t.reserve({ sale_id: 'cart-vrashtane' })).body.redemption_id;
  await t.pos('POST', `/api/loyalty/v1/redemptions/${id}/begin`, {});
  await t.send(sale(t.ref, {}, { sale_id: 'cart-vrashtane', total_cents: 820 }));
  assert.equal(t.points(), 28); // 100 − 80 + 8
  const refund = await t.send({ id: 'sale.refunded:R-7', type: 'sale.refunded', schema_version: 1, retailer_code: 'HORA', store_code: 'EAST', register_code: 'POS-1', occurred_at: '2026-11-18T09:00:00Z',
    data: { refund_id: 'R-7', original_sale_id: 'cart-vrashtane', customer_ref: t.ref, refunded_cents: 820, full: true, redemption_id: id } });
  assert.deepEqual([refund.body.outcome, refund.body.points], ['refund', -8]);
  assert.equal(t.points(), 100);
  assert.equal((await t.call('GET', `/api/loyalty/v1/redemptions/${id}`, null, t.east.token)).body.status, 'reversed');
});

test('сменена карта и чужд търговец не могат да резервират; наградата на ръка не се дава през касата', async () => {
  const t = await withRewards();
  assert.equal((await t.reserve({ retailer_code: 'DRUG' })).status, 404);
  assert.deepEqual([(await t.reserve({ reward_id: t.byHand })).body.error], ['no_reward']);
  assert.deepEqual([(await t.reserve({ total_cents: 150 })).body.error], ['discount_exceeds_total']);
  assert.equal((await t.reserve({ sale_id: 'има интервал' })).status, 400);
  core.replaceCard(t.db, t.me.me.id);
  assert.deepEqual([(await t.reserve({ customer_ref: t.card })).body.error], ['card_replaced']);
  assert.equal(t.points(), 100);
  // наградите в приложението (взимат се на ръка от касиера) работят както преди
  const inApp = await t.call('POST', `/api/rewards/${t.byHand}/redeem`, {}, t.me.token);
  assert.equal(inApp.status, 200);
  assert.equal(inApp.body.points, 50);
});

test('описанието за касата (OpenAPI) покрива точно пътищата, които съществуват', async () => {
  const t = await withRewards();
  const spec = (await t.call('GET', '/api/loyalty/v1/openapi.json')).body;
  assert.match(spec.openapi, /^3\./);
  const operations = Object.entries(spec.paths).flatMap(([path, methods]) => Object.keys(methods).filter((m) => ['get', 'post', 'put', 'delete'].includes(m)).map((m) => [m.toUpperCase(), path]));
  assert.deepEqual(operations.map(([m, p]) => `${m} ${p}`).sort(), [
    'GET /api/loyalty/v1/openapi.json', 'GET /api/loyalty/v1/redemptions/{id}',
    'POST /api/loyalty/v1/events', 'POST /api/loyalty/v1/members/resolve', 'POST /api/loyalty/v1/redemptions',
    'POST /api/loyalty/v1/redemptions/{id}/begin', 'POST /api/loyalty/v1/redemptions/{id}/commit', 'POST /api/loyalty/v1/redemptions/{id}/release',
    'POST /api/loyalty/v1/rewards/quote',
  ]);
  // всеки описан път наистина съществува: без ключ отговаря 401 (или 200 за самото описание), а не 404
  for (const [method, path] of operations) {
    const res = await t.call(method, path.replace('{id}', 'rd_x'), method === 'POST' ? {} : null);
    assert.equal(res.status, path.endsWith('openapi.json') ? 200 : 401, `${method} ${path}`);
  }
  // примерът от описанието на касата се приема както е написан
  const example = spec.components.examples.SaleCompleted.value;
  assert.equal(example.event.data.customer_ref, 'L-1042');
  t.db.prepare("UPDATE customers SET customer_ref = 'L-1042' WHERE id = ?").run(t.me.me.id);
  const sent = await t.call('POST', '/api/loyalty/v1/events', { ...example, source_id: 'east-pos-1', environment: 'production' }, t.east.token);
  assert.deepEqual([sent.status, sent.body.status, sent.body.points], [200, 'applied', 10]);
});
