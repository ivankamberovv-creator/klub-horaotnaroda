// Проверки на разделите, добавени след първата версия: бонуси, история на точките, магазини, новини, снимки, начало.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { createDemoKasa } from '../src/connectors/demo.js';
import { seedDemo, seedStores } from '../src/seed.js';
import * as core from '../src/core.js';

const base = { demo: true, adminPassword: 'admin-parola-123', kasaPin: '654321', pointsPerEuro: 1, cardPrefix: '29' };
// най-малката валидна PNG снимка (1×1 пиксел)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function setup(extra = {}) {
  const db = openDb(':memory:');
  seedDemo(db);
  db.exec('UPDATE challenges SET active = 0'); // примерните мисии имат отделни проверки (zabavno.test.js)
  seedStores(db);
  const config = { ...base, uploadDir: mkdtempSync(join(tmpdir(), 'klub-')), ...extra };
  const app = await buildApp({ db, config, mail: { send: async () => {} }, kasa: createDemoKasa() });
  const call = async (method, url, body, token) => {
    const res = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch { /* не е JSON */ }
    return { status: res.statusCode, body: parsed, raw: res };
  };
  const login = async (email = 'maria@primer.bg') => {
    const r = await call('POST', '/api/auth/request-code', { email });
    return (await call('POST', '/api/auth/verify', { email, code: r.body.demoCode })).body;
  };
  const staff = async (password) => (await call('POST', '/api/staff/login', { password })).body.token;
  return { db, app, call, login, staff, config };
}

test('точки за добре дошли: не при записването, а веднъж, с първата покупка, и се виждат в историята', async () => {
  const t = await setup({ welcomePoints: 20 });
  const me = await t.login();
  assert.equal(me.me.points, 0); // само записване не носи точки: нов имейл се прави за минута
  assert.equal((await t.login('vtori@primer.bg')).me.points, 0);
  const kasa = await t.staff('654321');
  const first = await t.call('POST', '/api/kasa/demo-purchase', { cardCode: me.me.cardCode, totalCents: 20000, shop: 'Варна, Трошево' }, kasa);
  assert.equal(first.body.points, 220); // 200 от покупката + 20 за добре дошли
  const second = await t.call('POST', '/api/kasa/demo-purchase', { cardCode: me.me.cardCode, totalCents: 8000, shop: 'Варна, Трошево' }, kasa);
  assert.equal(second.body.points, 300); // втората покупка не дава подаръка пак
  const rewards = (await t.call('GET', '/api/rewards', null, me.token)).body.rewards;
  await t.call('POST', `/api/rewards/${rewards[0].id}/redeem`, null, me.token);
  const h = (await t.call('GET', '/api/points-history', null, me.token)).body;
  assert.equal(h.points, 200);
  assert.deepEqual(h.history.map((x) => [x.delta, x.label]), [[-100, 'Награда: Отстъпка 2 €'], [80, 'Покупка: Варна, Трошево'], [20, 'Добре дошли в клуба'], [200, 'Покупка: Варна, Трошево']]);
});

test('рожден ден: записва се веднъж и точките идват само на деня, веднъж в годината', async () => {
  assert.equal(core.parseBirthday('14.11'), '11-14');
  assert.equal(core.parseBirthday('1/3'), '03-01');
  assert.equal(core.parseBirthday('29.02.'), '02-29');
  for (const bad of ['', '31.04', '0.5', '14.13', '14', 'абв', '14.11.1990']) assert.equal(core.parseBirthday(bad), null, bad);
  assert.deepEqual(core.todayInSofia(new Date('2026-11-14T22:30:00Z')), { year: '2026', monthDay: '11-15' }); // в София вече е 15-и

  const t = await setup({ birthdayPoints: 50 });
  const me = await t.login();
  assert.equal((await t.call('PUT', '/api/me', { birthday: '32.01' }, me.token)).body.error, 'bad_birthday');
  const set = await t.call('PUT', '/api/me', { birthday: '15.11' }, me.token);
  assert.equal(set.body.birthday, '15.11');
  assert.equal((await t.call('PUT', '/api/me', { birthday: '16.11' }, me.token)).status, 409);

  const day = new Date('2026-11-15T09:00:00Z');
  // записан е току-що: на самия ден още не носи точки
  assert.equal(core.grantBirthdayBonus(t.db, me.me.id, 50, day), false);
  t.db.prepare('UPDATE customers SET birthday_set_at = ? WHERE id = ?').run('2026-09-01T00:00:00.000Z', me.me.id);
  assert.equal(core.grantBirthdayBonus(t.db, me.me.id, 50, new Date('2026-11-14T09:00:00Z')), false); // ден по-рано
  assert.equal(core.grantBirthdayBonus(t.db, me.me.id, 50, day), true);
  assert.equal(core.grantBirthdayBonus(t.db, me.me.id, 50, day), false); // втори път в същата година
  assert.equal(core.grantBirthdayBonus(t.db, me.me.id, 50, new Date('2027-11-15T09:00:00Z')), true);
  assert.equal(core.grantBirthdayBonus(t.db, me.me.id, 0, new Date('2028-11-15T09:00:00Z')), false); // изключени
  assert.equal(core.balance(t.db, me.me.id), 100);
  assert.equal(core.pointsHistory(t.db, me.me.id)[0].label, 'Честит рожден ден');
});

test('магазини: списък, любим магазин и проверка на работното време', async () => {
  const t = await setup();
  const me = await t.login();
  const stores = (await t.call('GET', '/api/stores', null, me.token)).body.stores;
  assert.equal(stores.length, 18);
  const first = stores.find((s) => s.name === 'Варна, Трошево');
  assert.equal(first.hours.length, 7);
  assert.equal(first.phone, '+359896085158');

  assert.equal((await t.call('PUT', '/api/me', { favoriteStoreId: first.id }, me.token)).body.favoriteStoreId, first.id);
  assert.equal((await t.call('PUT', '/api/me', { favoriteStoreId: 99999 }, me.token)).status, 404);
  assert.equal((await t.call('PUT', '/api/me', { favoriteStoreId: null }, me.token)).body.favoriteStoreId, null);

  const admin = await t.staff('admin-parola-123');
  const bad = await t.call('POST', '/api/admin/stores', { name: 'Нов', hours: [['8:00', '25:00']] }, admin);
  assert.equal(bad.body.error, 'bad_hours');
  const made = await t.call('POST', '/api/admin/stores', { name: 'Русе, Център', city: 'Русе', address: 'ул. Александровска 1', phone: '+359 888 000 111',
    hours: [['9:00', '19:00'], ['9:00', '19:00'], ['9:00', '19:00'], ['9:00', '19:00'], ['9:00', '19:00'], ['9:00', '14:00'], null] }, admin);
  assert.equal(made.status, 200);
  assert.equal((await t.call('GET', '/api/stores', null, me.token)).body.stores.length, 19);
  await t.call('PUT', `/api/admin/stores/${made.body.id}`, { ...made.body, active: false }, admin);
  assert.equal((await t.call('GET', '/api/stores', null, me.token)).body.stores.length, 18); // затворен магазин не се показва
  assert.equal((await t.call('GET', '/api/admin/stores', null, me.token)).status, 401);
});

test('новини: броят се непрочетените и отварянето ги отбелязва', async () => {
  const t = await setup();
  const me = await t.login();
  const admin = await t.staff('admin-parola-123');
  assert.equal((await t.call('GET', '/api/me', null, me.token)).body.unreadNews, 0); // новината от преди регистрацията не се брои
  await t.call('POST', '/api/admin/news', { title: 'Нов магазин в Русе', body: 'Отваряме на 1 декември.' }, admin);
  await t.call('POST', '/api/admin/news', { title: 'За следващия месец', published_at: '2099-01-01T00:00:00Z' }, admin);
  await t.call('POST', '/api/admin/news', { title: 'Скрита', active: false }, admin);
  assert.equal((await t.call('GET', '/api/me', null, me.token)).body.unreadNews, 1);
  const news = (await t.call('GET', '/api/news', null, me.token)).body.news;
  assert.deepEqual(news.map((n) => n.title), ['Нов магазин в Русе', 'Добре дошли в клуба']);
  assert.equal((await t.call('GET', '/api/me', null, me.token)).body.unreadNews, 0);
  assert.equal((await t.call('POST', '/api/admin/news', { title: 'X' }, admin)).body.error, 'bad_title');
});

test('снимки: качва се само истинска снимка и само от управлението; офертата я показва', async () => {
  const t = await setup();
  const admin = await t.staff('admin-parola-123'), kasa = await t.staff('654321');
  const me = await t.login();
  assert.equal((await t.call('POST', '/api/admin/upload', { data: PNG }, kasa)).status, 401);
  assert.equal((await t.call('POST', '/api/admin/upload', { data: Buffer.from('<script>alert(1)</script>').toString('base64') }, admin)).body.error, 'bad_image');
  assert.equal((await t.call('POST', '/api/admin/upload', { data: 'не е base64 !!!' }, admin)).body.error, 'bad_image');
  const up = await t.call('POST', '/api/admin/upload', { data: 'data:image/png;base64,' + PNG }, admin);
  assert.equal(up.status, 200);
  assert.match(up.body.url, /^\/uploads\/[a-f0-9]{24}\.png$/);
  assert.ok(existsSync(join(t.config.uploadDir, up.body.url.split('/').pop())));
  const served = await t.app.inject({ method: 'GET', url: up.body.url });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers['content-type'], 'image/png');

  const promo = await t.call('POST', '/api/admin/promotions', { title: 'Мед от Странджа', kind: 'discount', value: 15, image_url: up.body.url }, admin);
  assert.equal(promo.status, 200);
  assert.equal((await t.call('GET', '/api/promotions', null, me.token)).body.promotions[0].image_url, up.body.url);
  for (const bad of ['javascript:alert(1)', 'http://example.com/a.png', '/uploads/../../etc/passwd', '/etc/passwd']) {
    assert.equal((await t.call('POST', '/api/admin/promotions', { title: 'Лоша снимка', kind: 'info', image_url: bad }, admin)).body.error, 'bad_image', bad);
  }
});

test('началото идва с една заявка: профил, оферти, последна покупка, новини', async () => {
  const t = await setup();
  const me = await t.login();
  const kasa = await t.staff('654321');
  let home = (await t.call('GET', '/api/home', null, me.token)).body;
  assert.equal(home.lastPurchase, null);
  assert.equal(home.offers.length, 4);
  assert.equal(home.news.length, 1);
  await t.call('POST', '/api/kasa/demo-purchase', { cardCode: me.me.cardCode, totalCents: 1299, shop: 'Пловдив, Център' }, kasa);
  home = (await t.call('GET', '/api/home', null, me.token)).body;
  assert.equal(home.me.points, 12);
  assert.equal(home.lastPurchase.shop, 'Пловдив, Център');
  assert.equal((await t.call('GET', '/api/home')).status, 401);
});

test('по-стара база се довежда до новия вид, без да се губят данни', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'klub-db-')), 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', card_code TEXT NOT NULL UNIQUE, kasa_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE promotions (id INTEGER PRIMARY KEY, title TEXT NOT NULL, tag TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0, min_total_cents INTEGER NOT NULL DEFAULT 0, starts_at TEXT, ends_at TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE points_ledger (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, delta INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('purchase','reward','reward_refund','adjustment')), ref TEXT, created_at TEXT NOT NULL);
    CREATE TABLE otp_codes (phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE otp_requests (id INTEGER PRIMARY KEY, phone TEXT NOT NULL, ip TEXT, at TEXT NOT NULL);
    CREATE INDEX otp_requests_phone ON otp_requests(phone, at);
    INSERT INTO otp_requests (phone, ip, at) VALUES ('+359888123456', '', '2026-11-14T00:00:00.000Z');
    INSERT INTO customers (phone, card_code, created_at) VALUES ('+359888123456', '2912345678905', '2026-11-14T00:00:00.000Z');
    INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (1, 340, 'purchase', '1', '2026-11-14T00:00:00.000Z');
    INSERT INTO promotions (title, kind, created_at) VALUES ('Стара', 'info', '2026-11-14T00:00:00.000Z');
  `);
  old.close();
  const db = openDb(path);
  assert.equal(core.balance(db, 1), 340);
  db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (1, 20, 'bonus', 'welcome', ?)").run(core.nowIso());
  assert.equal(core.balance(db, 1), 360);
  assert.equal(core.listPromotions(db, 1)[0].image_url, '');
  assert.equal(core.customerSummary(db, 1).birthday, null);
  // клиентът беше с телефон: записът, кодът на картата и точките остават, а входът вече е с имейл
  const kept = core.customerSummary(db, 1);
  assert.equal(kept.email, 'tel359888123456@bez-imeil.invalid');
  assert.equal(kept.cardCode, '2912345678905');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const { code } = core.requestCode(db, 'nov@primer.bg');
  const fresh = core.verifyCode(db, 'nov@primer.bg', code);
  assert.equal(fresh.isNew, true);
  assert.equal(fresh.customer.id, 2);
  // външните ключове още работят: изтрит клиент отнася и точките си
  db.prepare('DELETE FROM customers WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM points_ledger WHERE customer_id = 1').get().n, 0);
  db.close();
  openDb(path).close(); // второ отваряне не прави нищо
});

test('сървърът сервира приложението на „/“, страницата за служители на „/admin/“ и не пази страницата в браузъра', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'klub-app-'));
  writeFileSync(join(appDir, 'index.html'), '<!doctype html><title>Приложението</title>');
  writeFileSync(join(appDir, 'sw.js'), '// работник');
  mkdirSync(join(appDir, '_expo'));
  writeFileSync(join(appDir, '_expo', 'app.js'), 'console.log(1)');
  const t = await setup({ appDir });
  const page = await t.app.inject({ method: 'GET', url: '/' });
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes('Приложението'));
  assert.equal(page.headers['cache-control'], 'no-cache');
  assert.equal((await t.app.inject({ method: 'GET', url: '/sw.js' })).headers['cache-control'], 'no-cache');
  const js = await t.app.inject({ method: 'GET', url: '/_expo/app.js' });
  assert.equal(js.statusCode, 200);
  assert.notEqual(js.headers['cache-control'], 'no-cache');
  const admin = await t.app.inject({ method: 'GET', url: '/admin/' });
  assert.equal(admin.statusCode, 200);
  assert.ok(admin.body.includes('Вход за служители'));
  assert.equal((await t.app.inject({ method: 'GET', url: '/admin/admin.js' })).statusCode, 200);
  assert.equal((await t.call('GET', '/няма-такова')).status, 404);

  // без построено приложение на „/“ стои кратката страница на сървъра
  const bare = await setup();
  const fallback = await bare.app.inject({ method: 'GET', url: '/' });
  assert.equal(fallback.statusCode, 200);
  assert.ok(fallback.body.includes('Клуб'));
});
