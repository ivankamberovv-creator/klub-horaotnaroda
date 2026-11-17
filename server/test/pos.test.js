// Връзката с касата Vamibex POS: приемане на sale.completed, еднократно действие, една карта във всички магазини,
// отделни данни за пробната среда, карантина, смяна на карта и връщане на стока.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import * as core from '../src/core.js';
import * as loyalty from '../src/loyalty.js';
import { base, setup, sale } from './pos-pomosht.js';

test('новият клиент получава постоянен код във вида на касата и карта в списъка с карти', async () => {
  const t = await setup();
  assert.match(t.ref, /^L-[A-HJ-NP-Z2-9]{8}$/);
  assert.match(t.ref, /^[A-Za-z0-9_-]{1,64}$/); // правилото на касата за customer_ref
  assert.deepEqual(t.db.prepare('SELECT code, status FROM cards').all().map((c) => ({ ...c })), [{ code: t.card, status: 'active' }]);
});

test('само инсталация с верен ключ може да праща събития', async () => {
  const t = await setup();
  const event = sale(t.ref);
  assert.equal((await t.call('POST', '/api/loyalty/v1/events', { source_id: 'east-pos-1', environment: 'production', event })).status, 401);
  assert.equal((await t.call('POST', '/api/loyalty/v1/events', { source_id: 'east-pos-1', environment: 'production', event }, 'greshen-klyuch')).status, 401);
  // ключът на клиент от приложението не е ключ на каса
  assert.equal((await t.call('POST', '/api/loyalty/v1/events', { source_id: 'east-pos-1', environment: 'production', event }, t.me.token)).status, 401);
  // чужд source_id с моя ключ
  const other = await t.call('POST', '/api/loyalty/v1/events', { source_id: 'west-pos-1', environment: 'production', event }, t.east.token);
  assert.equal(other.status, 403);
  assert.equal(other.body.error, 'source_mismatch');
  assert.equal((await t.call('POST', '/api/loyalty/v1/events', { source_id: 'east-pos-1', environment: 'nyama-takava', event }, t.east.token)).status, 400);
  assert.equal((await t.call('POST', '/api/loyalty/v1/events', { source_id: 'east-pos-1', event }, t.east.token)).status, 400);
  assert.equal(t.points(), 0);
  // спряна инсталация вече не се приема
  loyalty.setSourceActive(t.db, 'east-pos-1', false);
  assert.equal((await t.send(event)).status, 401);
});

test('sale.completed носи точки, покупката се вижда в приложението, а повторението не действа втори път', async () => {
  const t = await setup();
  t.db.prepare("INSERT INTO stores (name, city, pos_code, created_at) VALUES ('Хора от Народа Изток', 'София', 'EAST', '2026-01-01')").run();
  const event = sale(t.ref);
  const first = await t.send(event);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { event_id: event.id, status: 'applied', outcome: 'points', points: 10 }); // 10,20 € → 10 точки
  assert.equal(t.points(), 10);

  const again = await t.send(event);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { event_id: event.id, status: 'duplicate', outcome: 'points', points: 10 });
  // същото събитие, пратено от друга каса, също не действа втори път
  assert.equal((await t.send(event, t.west)).body.status, 'duplicate');
  assert.equal(t.points(), 10);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM purchases').get().n, 1);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM pos_events').get().n, 1);

  const list = await t.call('GET', '/api/purchases', null, t.me.token);
  assert.equal(list.body.purchases.length, 1);
  assert.equal(list.body.purchases[0].shop, 'Хора от Народа Изток'); // името на магазина по кода му в касата
  assert.equal(list.body.purchases[0].total_cents, 1020);
  const one = await t.call('GET', `/api/purchases/${list.body.purchases[0].id}`, null, t.me.token);
  assert.deepEqual(one.body.items.map((i) => [i.name, i.quantity, i.total_cents]), [['P-01', 2, 240], ['P-02', 1, 780]]);
  const row = t.db.prepare('SELECT store_code, register_code, source FROM purchases').get();
  assert.deepEqual({ ...row }, { store_code: 'EAST', register_code: 'POS-1', source: 'vamibex' });
  // инсталацията помни докъде е стигнала касата
  assert.equal(loyalty.listSources(t.db).find((s) => s.source_id === 'east-pos-1').last_sequence, event.sequence);
});

test('голяма продажба с много редове се приема цялата', async () => {
  const t = await setup();
  const items = Array.from({ length: 1500 }, (_, i) => ({ sku: `ARTIKUL-S-DALAG-KOD-${String(i).padStart(6, '0')}`, quantity: 1, total_cents: 100 }));
  const big = await t.send(sale(t.ref, {}, { total_cents: 150000, items }));
  assert.deepEqual([big.status, big.body.status, big.body.points], [200, 'applied', 1500]);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM purchase_items').get().n, 1500);
});

test('една карта във всички магазини: точките от различни каси отиват в едно салдо', async () => {
  const t = await setup();
  assert.equal((await t.send(sale(t.ref, { store_code: 'EAST', register_code: 'POS-1' }), t.east)).body.points, 10);
  assert.equal((await t.send(sale(t.ref, { store_code: 'WEST', register_code: 'POS-2' }, { total_cents: 2599 }), t.west)).body.points, 25);
  // касиерът може да е сканирал баркода на картата вместо постоянния код: клиентът е същият
  assert.equal((await t.send(sale(t.card, { store_code: 'WEST' }, { total_cents: 500 }), t.west)).body.points, 5);
  assert.equal(t.points(), 40);
  assert.deepEqual(t.db.prepare('SELECT DISTINCT customer_id FROM purchases').all().length, 1);
  assert.deepEqual(t.db.prepare('SELECT store_code FROM purchases ORDER BY id').all().map((p) => p.store_code), ['EAST', 'WEST', 'WEST']);
});

test('продажба без право на точки се приключва с нулево начисляване', async () => {
  const t = await setup();
  const unknown = await t.send(sale('L-NEPOZNAT'));
  assert.deepEqual([unknown.status, unknown.body.status, unknown.body.outcome, unknown.body.points], [200, 'applied', 'unknown_customer', 0]);
  const noRef = await t.send(sale(null));
  assert.deepEqual([noRef.body.status, noRef.body.outcome], ['applied', 'no_customer_ref']);
  const small = await t.send(sale(t.ref, {}, { total_cents: 99, items: [{ sku: 'P-01', quantity: 1, total_cents: 99 }] }));
  assert.deepEqual([small.body.status, small.body.outcome, small.body.points], ['applied', 'zero_points', 0]);
  assert.equal(t.points(), 0);
  // и трите са записани като обработени: при повторение не се пробват наново
  assert.equal((await t.send(sale('L-NEPOZNAT', {}, { sale_id: 'x'.repeat(32) }))).body.status, 'applied');
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM pos_events WHERE status = 'applied'").get().n, 4);
});

test('правилата за начисляване се настройват: артикули без точки и минимална покупка', async () => {
  const t = await setup({ pointsPerEuro: 2, earn: { excludedSkus: ['ALC-*', 'TOB-1'], minTotalCents: 500 } });
  const items = [{ sku: 'ALC-RAKIA', quantity: 1, total_cents: 1500 }, { sku: 'TOB-1', quantity: 1, total_cents: 600 }, { sku: 'P-01', quantity: 1, total_cents: 450 }];
  // 25,50 € общо, но точки носят само 4,50 € → 4 цели евро × 2
  assert.equal((await t.send(sale(t.ref, {}, { total_cents: 2550, items }))).body.points, 8);
  // под минималната покупка няма точки
  assert.equal((await t.send(sale(t.ref, {}, { total_cents: 499, items: [{ sku: 'P-01', quantity: 1, total_cents: 499 }] }))).body.points, 0);
  assert.equal(loyalty.pointsBaseCents(1000, [{ sku: 'ALC-1', total_cents: 1200 }], { excludedSkus: ['ALC-*'] }), 0);
  assert.deepEqual(loyalty.parseSkuList(' ALC-*, TOB-1 ,,'), ['ALC-*', 'TOB-1']);
});

test('пробната среда (simulation) има отделни клиенти и точки и не пипа истинските', async () => {
  const t = await setup(); // приложението работи с production
  const event = sale(t.ref);
  // същият код на клиент в пробната среда е непознат: там има други, пробни клиенти
  const sim = await t.send(event, t.east, 'simulation');
  assert.deepEqual([sim.status, sim.body.status, sim.body.outcome], [200, 'applied', 'unknown_customer']);
  assert.equal(t.points(), 0);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM pos_events').get().n, 0);
  // същият номер на събитие в истинската среда е отделно събитие
  const live = await t.send(event, t.east, 'production');
  assert.deepEqual([live.body.status, live.body.points], ['applied', 10]);
  assert.equal(t.points(), 10);
  assert.equal((await t.send(event, t.east, 'simulation')).body.status, 'duplicate');
  assert.equal((await t.call('GET', '/api/health')).body.environment, 'production');
});

test('непозната версия или невалидни данни отиват за преглед и могат да се пратят пак след поправка', async () => {
  const t = await setup();
  const event = sale(t.ref);
  const bad = await t.send({ ...event, schema_version: 2 });
  assert.equal(bad.status, 202);
  assert.deepEqual(bad.body, { event_id: event.id, status: 'quarantined', outcome: 'unknown_schema_version', points: 0 });
  assert.equal(t.points(), 0);
  const kept = t.db.prepare('SELECT status, outcome, payload FROM pos_events').get();
  assert.equal(kept.status, 'quarantined');
  assert.equal(JSON.parse(kept.payload).schema_version, 2); // пази се точно каквото е дошло

  for (const [change, reason] of [
    [{ type: 'sale.voided' }, 'unknown_type'], [{ retailer_code: 'DRUG' }, 'unknown_retailer'], [{ occurred_at: 'vchera' }, 'bad_occurred_at'],
    [{ data: { ...event.data, currency: 'BGN' } }, 'unsupported_currency'], [{ data: { ...event.data, total_cents: 10.5 } }, 'bad_total'],
    [{ data: { ...event.data, customer_ref: 'има интервал' } }, 'bad_customer_ref'], [{ data: { ...event.data, items: [{ sku: 'P', quantity: 0, total_cents: 1 }] } }, 'bad_item_quantity'],
  ]) {
    const r = await t.send({ ...sale(t.ref), ...change });
    assert.deepEqual([r.status, r.body.status, r.body.outcome], [202, 'quarantined', reason], reason);
  }
  assert.equal(t.points(), 0);
  // събитие без номер няма как да се пази по номер
  assert.equal((await t.send({ ...event, id: undefined })).status, 400);

  // същото събитие, вече във вярната версия, се прилага
  const fixed = await t.send(event);
  assert.deepEqual([fixed.status, fixed.body.status, fixed.body.points], [200, 'applied', 10]);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM pos_events WHERE event_id = ?').get(event.id).n, 1);
  const staff = (await t.call('POST', '/api/staff/login', { password: base.adminPassword })).body.token;
  const review = await t.call('GET', '/api/admin/pos-events?status=quarantined', null, staff);
  assert.equal(review.body.events.length, 7);
});

test('смяна на карта: профилът, точките и постоянният код остават, старата карта спира да важи', async () => {
  const t = await setup();
  await t.send(sale(t.ref));
  const staff = (await t.call('POST', '/api/staff/login', { password: base.adminPassword })).body.token;
  const replaced = await t.call('POST', `/api/admin/customers/${t.me.me.id}/replace-card`, {}, staff);
  assert.equal(replaced.status, 200);
  assert.notEqual(replaced.body.cardCode, t.card);
  assert.ok(core.isValidEan13(replaced.body.cardCode));
  assert.equal(replaced.body.customerRef, t.ref);
  assert.equal((await t.call('GET', '/api/me', null, t.me.token)).body.cardCode, replaced.body.cardCode);

  const resolve = (card) => t.call('POST', '/api/loyalty/v1/members/resolve', { retailer_code: 'HORA', card_code: card }, t.east.token);
  assert.deepEqual((await resolve(replaced.body.cardCode)).body, { customer_ref: t.ref, membership_status: 'active', balance_points: 10 });
  assert.deepEqual((await resolve(t.ref)).body, { customer_ref: t.ref, membership_status: 'active', balance_points: 10 });
  assert.deepEqual((await resolve(t.card)).body, { customer_ref: null, membership_status: 'card_replaced', balance_points: 0 });
  assert.equal((await resolve('2900000000000')).status, 404);
  assert.equal((await t.call('POST', '/api/loyalty/v1/members/resolve', { retailer_code: 'DRUG', card_code: t.ref }, t.east.token)).status, 404);
  assert.equal((await t.call('POST', '/api/loyalty/v1/members/resolve', { retailer_code: 'HORA', card_code: t.ref })).status, 401);

  // продажба със старата карта не носи точки; с новата и с постоянния код носи
  assert.deepEqual([(await t.send(sale(t.card))).body.outcome, t.points()], ['card_replaced', 10]);
  assert.equal((await t.send(sale(replaced.body.cardCode))).body.points, 10);
  assert.equal((await t.send(sale(t.ref))).body.points, 10);
  assert.equal(t.points(), 30);
  // кодът на старата карта не се дава на друг
  assert.equal(t.db.prepare("SELECT status FROM cards WHERE code = ?").get(t.card).status, 'replaced');
});

test('връщане на стока (предложен формат sale.refunded): точките се взимат обратно веднъж', async () => {
  const t = await setup();
  const original = sale(t.ref, {}, { total_cents: 2000, items: [{ sku: 'P-01', quantity: 4, total_cents: 2000 }] });
  await t.send(original);
  assert.equal(t.points(), 20);
  const refund = (id, cents, extra = {}) => ({
    id: `sale.refunded:${id}`, sequence: 900 + cents, type: 'sale.refunded', schema_version: 1, retailer_code: 'HORA', store_code: 'WEST', register_code: 'POS-2',
    occurred_at: '2026-11-18T09:00:00.000+00:00',
    data: { refund_id: id, original_sale_id: original.data.sale_id, original_event_id: original.id, customer_ref: t.ref, refunded_cents: cents, currency: 'EUR', ...extra },
  });
  // частично връщане на 5 € от 20 €: една четвърт от точките
  const part = await t.send(refund('R-1', 500), t.west);
  assert.deepEqual([part.status, part.body.status, part.body.outcome, part.body.points], [200, 'applied', 'refund', -5]);
  assert.equal(t.points(), 15);
  assert.equal((await t.send(refund('R-1', 500), t.west)).body.status, 'duplicate');
  // същото връщане под друг номер на събитие също не действа втори път
  const sameRefund = await t.send({ ...refund('R-1', 500), id: 'sale.refunded:R-1-povtorno' });
  assert.deepEqual([sameRefund.body.outcome, sameRefund.body.points], ['refund_already_applied', 0]);
  assert.equal(t.points(), 15);
  // връщане на останалото: всички точки от покупката са взети, нито една повече
  assert.equal((await t.send(refund('R-2', 1500))).body.points, -15);
  assert.equal(t.points(), 0);
  assert.equal(t.db.prepare('SELECT refunded_cents FROM purchases').get().refunded_cents, 2000);
  const history = (await t.call('GET', '/api/points-history', null, t.me.token)).body.history;
  assert.deepEqual(history.map((h) => [h.label, h.delta]), [['Върната покупка', -15], ['Върната покупка', -5], ['Покупка: EAST', 20]]);
});

test('връщане, дошло преди самата продажба, се прилага, щом продажбата пристигне', async () => {
  const t = await setup();
  const original = sale(t.ref, {}, { total_cents: 1000 });
  const refund = { id: 'sale.refunded:R-9', sequence: 5, type: 'sale.refunded', schema_version: 1, retailer_code: 'HORA', store_code: 'WEST', register_code: 'POS-2',
    occurred_at: '2026-11-18T09:00:00.000+00:00', data: { refund_id: 'R-9', original_sale_id: original.data.sale_id, customer_ref: t.ref, refunded_cents: 1000, full: true } };
  const early = await t.send(refund, t.west);
  assert.deepEqual([early.body.status, early.body.outcome], ['applied', 'unknown_sale']);
  assert.equal((await t.send(original, t.east)).body.points, 10);
  assert.equal(t.points(), 0); // точките са дошли и веднага са взети обратно
  assert.equal(t.db.prepare("SELECT outcome FROM pos_events WHERE event_id = 'sale.refunded:R-9'").get().outcome, 'refund');
});

test('ако точките вече са изхарчени, връщането оставя салдото отрицателно, а не го прикрива', async () => {
  const t = await setup();
  const original = sale(t.ref, {}, { total_cents: 5000 });
  await t.send(original);
  t.db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, -50, 'adjustment', 'proba', '2026-11-17')").run(t.me.me.id);
  assert.equal(t.points(), 0);
  await t.send({ id: 'sale.refunded:R-3', type: 'sale.refunded', schema_version: 1, retailer_code: 'HORA', store_code: 'EAST', register_code: 'POS-1', occurred_at: '2026-11-18T09:00:00Z',
    data: { refund_id: 'R-3', original_sale_id: original.data.sale_id, customer_ref: t.ref, refunded_cents: 5000 } });
  assert.equal(t.points(), -50);
});

test('стара база от преди връзката с касата: клиентите получават постоянен код и карта, без да губят нищо', () => {
  const dir = mkdtempSync(join(tmpdir(), 'klub-'));
  try {
    const path = join(dir, 'staro.db');
    let db = openDb(path);
    db.exec(`INSERT INTO customers (email, card_code, created_at) VALUES ('a@primer.bg', '2912345678905', '2026-11-01'), ('b@primer.bg', '2900000000017', '2026-11-02');
      INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (1, 30, 'bonus', 'welcome', '2026-11-01');`);
    db.close();
    db = openDb(path);
    const rows = db.prepare('SELECT id, customer_ref, card_code FROM customers ORDER BY id').all();
    assert.equal(rows.length, 2);
    for (const r of rows) assert.match(r.customer_ref, /^L-[A-HJ-NP-Z2-9]{8}$/);
    assert.notEqual(rows[0].customer_ref, rows[1].customer_ref);
    assert.deepEqual(db.prepare('SELECT code, customer_id, status FROM cards ORDER BY customer_id').all().map((c) => ({ ...c })),
      [{ code: '2912345678905', customer_id: 1, status: 'active' }, { code: '2900000000017', customer_id: 2, status: 'active' }]);
    assert.equal(core.balance(db, 1), 30);
    // второ отваряне не сменя кодовете
    const ref = rows[0].customer_ref;
    db.close();
    db = openDb(path);
    assert.equal(db.prepare('SELECT customer_ref FROM customers WHERE id = 1').get().customer_ref, ref);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('управление: инсталациите на каси се създават с ключ, който се показва само веднъж', async () => {
  const t = await setup();
  const staff = (await t.call('POST', '/api/staff/login', { password: base.adminPassword })).body.token;
  const kasa = (await t.call('POST', '/api/staff/login', { password: base.kasaPin })).body.token;
  assert.equal((await t.call('POST', '/api/admin/pos-sources', { source_id: 'north-pos-1' }, kasa)).status, 401);
  const made = await t.call('POST', '/api/admin/pos-sources', { source_id: 'north-pos-1', note: 'Северен магазин, каса 1' }, staff);
  assert.equal(made.status, 200);
  assert.match(made.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await t.call('POST', '/api/admin/pos-sources', { source_id: 'north-pos-1' }, staff)).status, 409);
  assert.equal((await t.call('POST', '/api/admin/pos-sources', { source_id: 'с интервал' }, staff)).status, 400);
  const list = await t.call('GET', '/api/admin/pos-sources', null, staff);
  assert.deepEqual(list.body.sources.map((s) => s.source_id), ['east-pos-1', 'north-pos-1', 'west-pos-1']);
  assert.ok(!JSON.stringify(list.body).includes(made.body.token)); // ключът не се връща втори път
  assert.equal(t.db.prepare("SELECT token_hash FROM pos_sources WHERE source_id = 'north-pos-1'").get().token_hash.length, 64);
  // новата инсталация работи; след смяна на ключа старият спира
  const north = { source_id: 'north-pos-1', token: made.body.token };
  assert.equal((await t.send(sale(t.ref), north)).body.points, 10);
  const rotated = await t.call('POST', '/api/admin/pos-sources/north-pos-1/token', {}, staff);
  assert.equal((await t.send(sale(t.ref), north)).status, 401);
  assert.equal((await t.send(sale(t.ref), { source_id: 'north-pos-1', token: rotated.body.token })).body.points, 10);
});
