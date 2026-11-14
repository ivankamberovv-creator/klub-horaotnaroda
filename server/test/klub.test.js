// Проверки на целия поток през HTTP: вход, код за касата, промоции, покупки, точки, награди, управление.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { createDemoKasa } from '../src/connectors/demo.js';
import { seedDemo } from '../src/seed.js';
import * as core from '../src/core.js';

const config = { demo: true, adminPassword: 'admin-parola-123', kasaPin: '654321', pointsPerEuro: 1, cardPrefix: '29' };

async function setup({ kasa = createDemoKasa(), cfg = config } = {}) {
  const db = openDb(':memory:');
  seedDemo(db);
  const sent = [];
  const app = await buildApp({ db, config: cfg, sms: { send: async (phone, text) => sent.push({ phone, text }) }, kasa });
  const call = async (method, url, body, token) => {
    const res = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  const login = async (phone = '0888123456') => {
    const r = await call('POST', '/api/auth/request-code', { phone });
    const v = await call('POST', '/api/auth/verify', { phone, code: r.body.demoCode });
    return v.body;
  };
  const staff = async (password) => (await call('POST', '/api/staff/login', { password })).body.token;
  return { db, app, call, login, staff, sent };
}

test('телефонът се уеднаквява и се приемат само български мобилни номера', () => {
  for (const ok of ['0888123456', '0888 123 456', '+359888123456', '00359 888 123 456', '359888123456', '0988-123-456']) {
    assert.match(core.normalizePhone(ok), /^\+359[89]\d{8}$/, ok);
  }
  assert.equal(core.normalizePhone('0888 123 456'), '+359888123456');
  for (const bad of ['', '123', '888123456', '02 987 6543', '+44 7700 900123', '08881234567', 'abc']) assert.equal(core.normalizePhone(bad), null, bad);
});

test('кодът за касата е валиден EAN-13 и е различен за всеки клиент', () => {
  assert.equal(core.ean13CheckDigit('400638133393'), '1'); // известен пример: 4006381333931
  assert.ok(core.isValidEan13('4006381333931'));
  assert.ok(!core.isValidEan13('4006381333932'));
  const db = openDb(':memory:');
  const codes = new Set();
  for (let i = 0; i < 200; i++) {
    const code = core.newCardCode(db);
    assert.ok(core.isValidEan13(code) && code.startsWith('29'), code);
    codes.add(code);
  }
  assert.equal(codes.size, 200);
});

test('вход: код по SMS, нов клиент, после същият клиент', async () => {
  const t = await setup();
  const r = await t.call('POST', '/api/auth/request-code', { phone: '0888 123 456' });
  assert.equal(r.status, 200);
  assert.match(r.body.demoCode, /^\d{6}$/);
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].phone, '+359888123456');
  assert.ok(t.sent[0].text.includes(r.body.demoCode));

  const wrong = await t.call('POST', '/api/auth/verify', { phone: '0888123456', code: r.body.demoCode === '000000' ? '000001' : '000000' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'code_wrong');

  const v = await t.call('POST', '/api/auth/verify', { phone: '+359888123456', code: r.body.demoCode });
  assert.equal(v.status, 200);
  assert.equal(v.body.isNew, true);
  assert.equal(v.body.me.points, 0);
  assert.ok(core.isValidEan13(v.body.me.cardCode));

  // кодът важи само веднъж
  assert.equal((await t.call('POST', '/api/auth/verify', { phone: '0888123456', code: r.body.demoCode })).body.error, 'code_expired');

  const again = await t.login('0888123456');
  assert.equal(again.isNew, false);
  assert.equal(again.me.cardCode, v.body.me.cardCode);

  const named = await t.call('PUT', '/api/me', { name: '  Мария   Петрова ' }, v.body.token);
  assert.equal(named.body.name, 'Мария Петрова');
  assert.equal((await t.call('PUT', '/api/me', { name: 'М' }, v.body.token)).body.error, 'bad_name');
});

test('вход: грешен номер, много искания и много грешни опити се спират', async () => {
  const t = await setup();
  assert.equal((await t.call('POST', '/api/auth/request-code', { phone: '12345' })).body.error, 'bad_phone');
  for (let i = 0; i < 3; i++) assert.equal((await t.call('POST', '/api/auth/request-code', { phone: '0899111222' })).status, 200);
  const fourth = await t.call('POST', '/api/auth/request-code', { phone: '0899111222' });
  assert.equal(fourth.status, 429);

  const r = await t.call('POST', '/api/auth/request-code', { phone: '0899333444' });
  const bad = r.body.demoCode === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i++) assert.equal((await t.call('POST', '/api/auth/verify', { phone: '0899333444', code: bad })).body.error, 'code_wrong');
  // след 5 грешни опита и верният код вече не минава
  const locked = await t.call('POST', '/api/auth/verify', { phone: '0899333444', code: r.body.demoCode });
  assert.equal(locked.status, 429);
});

test('без вход нищо от приложението не се вижда; чужда роля не минава', async () => {
  const t = await setup();
  for (const url of ['/api/me', '/api/promotions', '/api/rewards', '/api/purchases']) assert.equal((await t.call('GET', url)).status, 401, url);
  const me = await t.login();
  assert.equal((await t.call('GET', '/api/admin/stats', null, me.token)).status, 401);
  assert.equal((await t.call('GET', `/api/kasa/customer/${me.me.cardCode}`, null, me.token)).status, 401);
  const kasa = await t.staff('654321');
  assert.equal((await t.call('GET', '/api/admin/stats', null, kasa)).status, 401);
  assert.equal((await t.call('GET', '/api/me', null, kasa)).status, 401);
  assert.equal((await t.call('POST', '/api/staff/login', { password: 'грешна' })).status, 401);
});

test('покупка носи точки; активираните промоции ги умножават и добавят', async () => {
  const t = await setup();
  const me = await t.login();
  const kasa = await t.staff('654321');
  const buy = (totalCents, extra = {}) => t.call('POST', '/api/kasa/demo-purchase', { cardCode: me.me.cardCode, totalCents, shop: 'Варна, Трошево', ...extra }, kasa);

  let r = await buy(2450);
  assert.equal(r.status, 200);
  assert.equal(r.body.purchase.points_earned, 24); // 1 точка за всяко цяло евро
  assert.equal(r.body.points, 24);

  const promos = (await t.call('GET', '/api/promotions', null, me.token)).body.promotions;
  assert.equal(promos.length, 4);
  assert.ok(promos.every((p) => p.activated === false));
  const double = promos.find((p) => p.kind === 'double_points'), bonus = promos.find((p) => p.kind === 'bonus_points');

  await t.call('POST', `/api/promotions/${double.id}/activate`, null, me.token);
  r = await buy(1000);
  assert.equal(r.body.purchase.points_earned, 20); // двойни точки

  await t.call('POST', `/api/promotions/${bonus.id}/activate`, null, me.token);
  r = await buy(3000);
  assert.equal(r.body.purchase.points_earned, 90); // 30 × 2 + 30 отгоре
  r = await buy(2999);
  assert.equal(r.body.purchase.points_earned, 58); // под прага няма точки отгоре

  await t.call('DELETE', `/api/promotions/${double.id}/activate`, null, me.token);
  r = await buy(500);
  assert.equal(r.body.purchase.points_earned, 5);
  assert.equal(r.body.points, 24 + 20 + 90 + 58 + 5);

  const seen = await t.call('GET', `/api/kasa/customer/${me.me.cardCode}`, null, kasa);
  assert.equal(seen.body.points, 197);
  assert.deepEqual(seen.body.promotions.map((p) => p.kind), ['bonus_points']);
  assert.equal((await t.call('GET', '/api/kasa/customer/2900000000000', null, kasa)).status, 404);
  assert.equal((await buy(0)).body.error, 'bad_total');
});

test('един и същ документ от касата не носи точки два пъти', async () => {
  const t = await setup();
  const me = await t.login();
  const sale = { source: 'yanak', externalId: 'ДОК-1001', cardCode: me.me.cardCode, shop: 'София, Овча купел', totalCents: 1299, discountCents: 200,
    items: [{ name: 'VITALUX Детокс', quantity: 1, totalCents: 1299 }] };
  assert.equal(core.recordPurchase(t.db, sale).duplicate, false);
  assert.equal(core.recordPurchase(t.db, sale).duplicate, true);
  assert.equal(core.balance(t.db, me.me.id), 12);
  assert.equal(core.recordPurchase(t.db, { ...sale, externalId: 'ДОК-1002', cardCode: '2900000000000' }).skipped, 'unknown_customer');

  const list = await t.call('GET', '/api/purchases', null, me.token);
  assert.equal(list.body.purchases.length, 1);
  assert.deepEqual(list.body.totals, { count: 1, total_cents: 1299, discount_cents: 200 });
  const one = await t.call('GET', `/api/purchases/${list.body.purchases[0].id}`, null, me.token);
  assert.equal(one.body.items[0].name, 'VITALUX Детокс');

  // чужда покупка не се вижда
  const other = await t.login('0899000111');
  assert.equal((await t.call('GET', `/api/purchases/${list.body.purchases[0].id}`, null, other.token)).status, 404);
  assert.equal((await t.call('GET', '/api/purchases', null, other.token)).body.purchases.length, 0);
});

test('награди: точките се взимат веднага, касата издава или отказва', async () => {
  const t = await setup();
  const me = await t.login();
  const kasa = await t.staff('654321');
  await t.call('POST', '/api/kasa/demo-purchase', { cardCode: me.me.cardCode, totalCents: 34000 }, kasa); // 340 точки

  const rewards = (await t.call('GET', '/api/rewards', null, me.token)).body;
  assert.equal(rewards.points, 340);
  const [two, five, extract] = rewards.rewards;
  assert.deepEqual([two.cost_points, five.cost_points, extract.cost_points], [100, 250, 400]);

  const no = await t.call('POST', `/api/rewards/${extract.id}/redeem`, null, me.token);
  assert.equal(no.status, 409);
  assert.equal(no.body.message, 'Не достигат 60 точки.');

  const yes = await t.call('POST', `/api/rewards/${five.id}/redeem`, null, me.token);
  assert.equal(yes.body.points, 90);
  assert.equal(yes.body.redemption.status, 'pending');
  assert.equal((await t.call('POST', `/api/rewards/${two.id}/redeem`, null, me.token)).status, 409); // 90 < 100

  const seen = await t.call('GET', `/api/kasa/customer/${me.me.cardCode}`, null, kasa);
  assert.equal(seen.body.pendingRewards.length, 1);
  const rid = seen.body.pendingRewards[0].id;

  const cancelled = await t.call('POST', `/api/kasa/redemptions/${rid}/cancel`, null, kasa);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal((await t.call('GET', '/api/me', null, me.token)).body.points, 340); // точките се връщат
  assert.equal((await t.call('POST', `/api/kasa/redemptions/${rid}/issue`, null, kasa)).status, 409); // не може втори път

  const second = await t.call('POST', `/api/rewards/${five.id}/redeem`, null, me.token);
  const issued = await t.call('POST', `/api/kasa/redemptions/${second.body.redemption.id}/issue`, null, kasa);
  assert.equal(issued.body.status, 'issued');
  const me2 = (await t.call('GET', '/api/me', null, me.token)).body;
  assert.equal(me2.points, 90);
  assert.equal(me2.pendingRewards, 0);
  assert.deepEqual(me2.nextReward, { title: 'Отстъпка 2 €', costPoints: 100, missing: 10 });
});

test('управление: промоции и награди се добавят и спират; проверките хващат грешни стойности', async () => {
  const t = await setup();
  const admin = await t.staff('admin-parola-123');
  const me = await t.login();

  const bad = await t.call('POST', '/api/admin/promotions', { title: 'Отстъпка', kind: 'discount', value: 150 }, admin);
  assert.equal(bad.body.error, 'bad_value');
  assert.equal((await t.call('POST', '/api/admin/promotions', { title: 'X', kind: 'discount', value: 10 }, admin)).body.error, 'bad_title');
  assert.equal((await t.call('POST', '/api/admin/promotions', { title: 'Нова', kind: 'нещо' }, admin)).body.error, 'bad_kind');

  const made = await t.call('POST', '/api/admin/promotions', { title: '−10% на меда', tag: 'Ноември', kind: 'discount', value: 10 }, admin);
  assert.equal(made.status, 200);
  assert.equal((await t.call('GET', '/api/promotions', null, me.token)).body.promotions.length, 5);

  // спряна промоция изчезва от приложението; изтекла също
  await t.call('PUT', `/api/admin/promotions/${made.body.id}`, { ...made.body, active: false }, admin);
  assert.equal((await t.call('GET', '/api/promotions', null, me.token)).body.promotions.length, 4);
  await t.call('PUT', `/api/admin/promotions/${made.body.id}`, { ...made.body, active: true, ends_at: '2020-01-01T00:00:00Z' }, admin);
  assert.equal((await t.call('GET', '/api/promotions', null, me.token)).body.promotions.length, 4);
  assert.equal((await t.call('POST', `/api/promotions/${made.body.id}/activate`, null, me.token)).status, 404);

  const reward = await t.call('POST', '/api/admin/rewards', { title: 'Буркан мед', cost_points: 300 }, admin);
  assert.equal(reward.status, 200);
  assert.equal((await t.call('POST', '/api/admin/rewards', { title: 'Нищо', cost_points: 0 }, admin)).body.error, 'bad_cost');
  assert.equal((await t.call('GET', '/api/rewards', null, me.token)).body.rewards.length, 4);

  const stats = await t.call('GET', '/api/admin/stats', null, admin);
  assert.equal(stats.body.customers, 1);
  const found = await t.call('GET', '/api/admin/customers?q=888123', null, admin);
  assert.equal(found.body.customers.length, 1);
});

test('пробни покупки няма, когато касата е истинска', async () => {
  const t = await setup({ kasa: { name: 'yanak', canSimulate: false, fetchSales: null } });
  const me = await t.login();
  const kasa = await t.staff('654321');
  const r = await t.call('POST', '/api/kasa/demo-purchase', { cardCode: me.me.cardCode, totalCents: 1000 }, kasa);
  assert.equal(r.status, 403);
});

test('извън демото кодът за вход не се връща в отговора', async () => {
  const t = await setup({ cfg: { ...config, demo: false } });
  const r = await t.call('POST', '/api/auth/request-code', { phone: '0888123456' });
  assert.deepEqual(r.body, { sent: true });
  assert.equal(t.sent.length, 1);
});

test('изтриване на профила маха всичко за клиента', async () => {
  const t = await setup();
  const me = await t.login();
  const kasa = await t.staff('654321');
  await t.call('POST', '/api/kasa/demo-purchase', { cardCode: me.me.cardCode, totalCents: 5000 }, kasa);
  assert.equal((await t.call('DELETE', '/api/me', null, me.token)).status, 200);
  assert.equal((await t.call('GET', '/api/me', null, me.token)).status, 401);
  for (const table of ['customers', 'purchases', 'points_ledger', 'sessions']) {
    const where = table === 'sessions' ? " WHERE role = 'customer'" : '';
    assert.equal(t.db.prepare(`SELECT COUNT(*) n FROM ${table}${where}`).get().n, 0, table);
  }
});
