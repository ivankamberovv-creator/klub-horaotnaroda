// Времето: разчитане на отговора на MET Norway, запомняне между питанията и офертите, които зависят от него.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import * as core from '../src/core.js';
import { createDemoKasa } from '../src/connectors/demo.js';
import { seedDemo, seedDemoWeather, seedStores } from '../src/seed.js';
import { createWeather, fromSymbol, fromForecast, WEATHER_KINDS } from '../src/weather.js';

test('кодовете на MET Norway се свеждат до пет вида време; ясна нощ е отделно', () => {
  const kind = (code) => fromSymbol(code)?.kind ?? null;
  assert.equal(kind('clearsky_day'), 'sun');
  assert.equal(kind('fair_day'), 'sun');
  assert.equal(kind('clearsky_night'), 'moon');
  assert.equal(kind('fair_polartwilight'), 'sun');
  assert.equal(kind('partlycloudy_night'), 'clouds');
  assert.equal(kind('cloudy'), 'clouds');
  assert.equal(kind('fog'), 'fog');
  for (const code of ['lightrain', 'rain', 'heavyrain', 'rainshowers_day', 'heavyrainshowersandthunder_night', 'rainandthunder']) assert.equal(kind(code), 'rain', code);
  for (const code of ['lightsnow', 'snow', 'heavysnowshowers_day', 'snowandthunder', 'sleet', 'lightsleetshowers_night', 'lightssnowshowersandthunder_day']) assert.equal(kind(code), 'snow', code);
  for (const bad of ['', null, undefined, 'tornado', 'RAIN', 'rain_evening', 'rain day']) assert.equal(fromSymbol(bad), null, String(bad));
  assert.deepEqual(fromSymbol('partlycloudy_night'), { kind: 'clouds', isDay: false });
  assert.deepEqual(fromSymbol('rain'), { kind: 'rain', isDay: true });
});

const forecast = (rows) => ({ properties: { timeseries: rows.map(([time, temp, one, six]) => ({ time, data: {
  instant: { details: { air_temperature: temp } },
  ...(one ? { next_1_hours: { summary: { symbol_code: one } } } : {}),
  ...(six ? { next_6_hours: { summary: { symbol_code: six } } } : {}),
} })) } });

test('от прогнозата се взима записът за текущия час', () => {
  const body = forecast([
    ['2026-11-15T12:00:00Z', 9.6, 'cloudy'],
    ['2026-11-15T13:00:00Z', 8.4, 'lightrain'],
    ['2026-11-15T14:00:00Z', 7.2, 'snow'],
  ]);
  assert.deepEqual(fromForecast(body, Date.parse('2026-11-15T13:40:00Z')), { kind: 'rain', isDay: true, temp: 8 });
  assert.deepEqual(fromForecast(body, Date.parse('2026-11-15T11:00:00Z')), { kind: 'clouds', isDay: true, temp: 10 }); // всичко е в бъдещето: първият
  assert.deepEqual(fromForecast(body, Date.parse('2026-11-16T09:00:00Z')), { kind: 'snow', isDay: true, temp: 7 });   // всичко е минало: последният
  // далеч напред има само прогноза за шест часа
  assert.deepEqual(fromForecast(forecast([['2026-11-15T12:00:00Z', -1.4, null, 'fog']]), Date.parse('2026-11-15T12:10:00Z')), { kind: 'fog', isDay: true, temp: -1 });
  for (const bad of [null, {}, { properties: {} }, { properties: { timeseries: [] } }, forecast([['2026-11-15T12:00:00Z', 5, 'tornado']]), forecast([['2026-11-15T12:00:00Z', 5]])]) {
    assert.equal(fromForecast(bad, Date.parse('2026-11-15T12:10:00Z')), null);
  }
});

test('истинското време: пита MET Norway с адрес за връзка, помни отговора и не пита пак преди срока', async () => {
  let clock = Date.parse('2026-11-15T13:10:00Z');
  const calls = [];
  let answer = () => ({ ok: true, status: 200, headers: new Headers({ expires: new Date(clock + 45 * 60 * 1000).toUTCString() }),
    json: async () => forecast([['2026-11-15T13:00:00Z', 8.4, 'rain']]) });
  const weather = createWeather({ mode: 'live', contact: 'klub@primer.bg', now: () => clock, log: () => {},
    fetchImpl: async (url, init) => { calls.push({ url, ua: init.headers['user-agent'] }); return answer(); } });

  assert.deepEqual(await weather.at(43.2259392, 27.8832068), { kind: 'rain', isDay: true, temp: 8 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=43.2&lon=27.9');
  assert.equal(calls[0].ua, 'klub-horaotnaroda/1.0 klub@primer.bg');
  // друг магазин в същия град: същото питане, от запомненото
  await weather.at(43.21, 27.91);
  clock += 44 * 60 * 1000;
  await weather.at(43.2259392, 27.8832068);
  assert.equal(calls.length, 1);
  // друг град е отделно питане
  await weather.at(42.6977, 23.3219);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.endsWith('lat=42.7&lon=23.3'));

  // срокът мина: връща старото веднага и пита за ново
  clock += 2 * 60 * 1000;
  answer = () => ({ ok: true, status: 200, headers: new Headers(), json: async () => forecast([['2026-11-15T14:00:00Z', 2.1, 'snow']]) });
  assert.equal((await weather.at(43.2259392, 27.8832068)).kind, 'rain');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await weather.at(43.2259392, 27.8832068), { kind: 'snow', isDay: true, temp: 2 });
  assert.equal(calls.length, 3);

  // грешка от MET Norway: остава старото, а ново питане има чак след десет минути
  clock += 31 * 60 * 1000;
  answer = () => ({ ok: false, status: 503, headers: new Headers(), json: async () => ({}) });
  assert.equal((await weather.at(43.2259392, 27.8832068)).kind, 'snow');
  await new Promise((r) => setImmediate(r));
  clock += 9 * 60 * 1000;
  assert.equal((await weather.at(43.2259392, 27.8832068)).kind, 'snow');
  assert.equal(calls.length, 4);
  // след шест часа без връзка вече не показваме нищо, вместо да лъжем със старо време
  clock += 6 * 60 * 60 * 1000;
  await weather.at(43.2259392, 27.8832068);
  await new Promise((r) => setImmediate(r));
  clock += 60 * 1000;
  assert.equal(await weather.at(43.2259392, 27.8832068), null);
});

test('истинското време: бавен отговор не бави приложението, а без връзка просто няма време', async () => {
  let release;
  const slow = createWeather({ mode: 'live', contact: 'klub@primer.bg', log: () => {},
    fetchImpl: () => new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, headers: new Headers(), json: async () => forecast([[new Date().toISOString(), 5, 'fog']]) }); }) });
  const started = Date.now();
  assert.equal(await slow.at(43.2, 27.9, 40), null);
  assert.ok(Date.now() - started < 1000);
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await slow.at(43.2, 27.9, 40)).kind, 'fog'); // отговорът все пак е запомнен за следващия път

  const down = createWeather({ mode: 'live', contact: 'klub@primer.bg', log: () => {}, fetchImpl: async () => { throw new Error('няма мрежа'); } });
  assert.equal(await down.at(43.2, 27.9), null);
});

test('режими: off, зададено на ръка, демо и грешни настройки', async () => {
  assert.equal(await createWeather({ mode: 'off' }).at(43.2, 27.9), null);
  assert.equal(await createWeather().at(43.2, 27.9), null);
  assert.deepEqual(await createWeather({ mode: 'snow' }).at(43.2, 27.9), { kind: 'snow', isDay: true, temp: -2, sample: true });
  let clock = 0;
  const demo = createWeather({ mode: 'demo', now: () => clock });
  const seen = [];
  for (let i = 0; i < 5; i++) { seen.push((await demo.at(0, 0)).kind); clock += 2 * 60 * 1000; }
  assert.deepEqual(seen, WEATHER_KINDS);
  assert.throws(() => createWeather({ mode: 'gradushka' }), /gradushka/);
  assert.throws(() => createWeather({ mode: 'live' }), /WEATHER_CONTACT/);
});

// ---- оферти според времето ----

const config = { demo: true, adminPassword: 'много-дълга-парола', kasaPin: '654321', pointsPerEuro: 1, cardPrefix: '29', corsOrigin: '*' };
async function setup(kindNow) {
  const db = openDb(':memory:');
  seedDemo(db);
  seedDemoWeather(db);
  seedStores(db);
  const state = { now: kindNow, asked: [] };
  const weather = { at: async (lat, lng) => { state.asked.push([lat, lng]); return state.now ? { kind: state.now, isDay: true, temp: 9 } : null; } };
  const app = await buildApp({ db, config, mail: { send: async () => {} }, kasa: createDemoKasa(), weather });
  const call = async (method, url, body, token) => {
    const res = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  const r = await call('POST', '/api/auth/request-code', { email: 'maria@primer.bg' });
  const v = await call('POST', '/api/auth/verify', { email: 'maria@primer.bg', code: r.body.demoCode });
  const kasa = (await call('POST', '/api/staff/login', { password: '654321' })).body.token;
  return { db, call, state, token: v.body.token, me: v.body.me, kasa };
}
const titles = (promotions) => promotions.map((p) => p.title);

test('оферта според времето се вижда само при такова време; без време се виждат само обикновените', async () => {
  const t = await setup('rain');
  const rainy = (await t.call('GET', '/api/promotions', null, t.token)).body.promotions;
  assert.equal(rainy.length, 5);
  assert.equal(rainy[0].title, 'Вали дъжд: двойни точки');
  assert.equal(rainy[0].weather, 'rain');
  assert.equal(rainy[0].activated, false);
  assert.ok(rainy.slice(1).every((p) => p.weather === ''));

  t.state.now = 'snow';
  assert.deepEqual(titles((await t.call('GET', '/api/promotions', null, t.token)).body.promotions).filter((x) => x.startsWith('Вали')), ['Вали сняг: тройни точки']);
  t.state.now = 'moon'; // ясна нощ: време има, но оферти по него няма
  assert.equal((await t.call('GET', '/api/promotions', null, t.token)).body.promotions.length, 4);
  t.state.now = null;   // времето не се знае
  assert.equal((await t.call('GET', '/api/promotions', null, t.token)).body.promotions.length, 4);
});

test('началото носи времето за града на клиента: любимия му магазин, иначе града с най-много магазини', async () => {
  const t = await setup('fog');
  const home = (await t.call('GET', '/api/home', null, t.token)).body;
  assert.deepEqual(home.weather, { kind: 'fog', isDay: true, temp: 9, city: 'София', own: false });
  assert.equal(home.offers[0].title, 'Мъгливо е: +20 точки');

  const varna = t.db.prepare("SELECT id, lat, lng FROM stores WHERE name = 'Варна, Трошево'").get();
  await t.call('PUT', '/api/me', { favoriteStoreId: varna.id }, t.token);
  t.state.asked.length = 0;
  const mine = (await t.call('GET', '/api/home', null, t.token)).body;
  assert.deepEqual(mine.weather, { kind: 'fog', isDay: true, temp: 9, city: 'Варна', own: true });
  assert.deepEqual(t.state.asked, [[varna.lat, varna.lng]]);

  t.state.now = null;
  const none = (await t.call('GET', '/api/home', null, t.token)).body;
  assert.equal(none.weather, null);
  assert.equal(none.offers.length, 4);
});

test('оферта според времето: активира се само при такова време и важи до края на деня', async () => {
  const t = await setup('rain');
  const rain = t.db.prepare("SELECT id FROM promotions WHERE weather = 'rain'").get().id;
  const snow = t.db.prepare("SELECT id FROM promotions WHERE weather = 'snow'").get().id;

  // не вали сняг: офертата за сняг не може да се активира, дори някой да знае номера ѝ
  const refused = await t.call('POST', `/api/promotions/${snow}/activate`, null, t.token);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'weather_changed');

  const on = await t.call('POST', `/api/promotions/${rain}/activate`, null, t.token);
  assert.equal(on.status, 200);
  assert.equal(on.body.promotions.find((p) => p.id === rain).activated, true);

  // дъждът спря: активираната оферта остава видима и важи, втори път активиране не пречи
  t.state.now = 'sun';
  const after = (await t.call('GET', '/api/promotions', null, t.token)).body.promotions;
  assert.equal(after.find((p) => p.id === rain).activated, true);
  assert.equal(after.filter((p) => p.weather).length, 2); // активираната за дъжд и новата за слънце
  assert.equal((await t.call('POST', `/api/promotions/${rain}/activate`, null, t.token)).status, 200);
  assert.equal((await t.call('GET', '/api/me', null, t.token)).body.activePromotions, 1);

  // покупка същия ден: двойни точки
  const bought = await t.call('POST', '/api/kasa/demo-purchase', { cardCode: t.me.cardCode, totalCents: 2000 }, t.kasa);
  assert.equal(bought.body.points, 40);
  const seen = await t.call('GET', `/api/kasa/customer/${t.me.cardCode}`, null, t.kasa);
  assert.deepEqual(titles(seen.body.promotions), ['Вали дъжд: двойни точки']);
});

test('оферта според времето от вчера вече не важи: нито за точки, нито на касата, и се активира наново', async () => {
  const t = await setup('rain');
  const rain = t.db.prepare("SELECT id FROM promotions WHERE weather = 'rain'").get().id;
  const always = t.db.prepare("SELECT id FROM promotions WHERE title = 'Двойни точки'").get().id;
  const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  core.activatePromotion(t.db, t.me.id, rain, { at: yesterday, weather: 'rain' });
  core.activatePromotion(t.db, t.me.id, always, { at: yesterday });

  // вчерашното активиране: за вчерашна покупка важи, за днешна не
  assert.equal(core.pointsFor(t.db, t.me.id, 2000, yesterday), 40);
  assert.deepEqual(core.activePromotions(t.db, t.me.id).map((p) => p.title), ['Двойни точки']);
  t.db.prepare('DELETE FROM activations WHERE promotion_id = ?').run(always);
  assert.equal(core.pointsFor(t.db, t.me.id, 2000, new Date().toISOString()), 20);
  assert.equal((await t.call('GET', '/api/me', null, t.token)).body.activePromotions, 0);

  // днес пак вали: офертата се показва като неактивирана и се активира наново
  const list = (await t.call('GET', '/api/promotions', null, t.token)).body.promotions;
  assert.equal(list.find((p) => p.id === rain).activated, false);
  const again = await t.call('POST', `/api/promotions/${rain}/activate`, null, t.token);
  assert.equal(again.body.promotions.find((p) => p.id === rain).activated, true);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM activations WHERE promotion_id = ?').get(rain).n, 1);
  assert.equal(core.pointsFor(t.db, t.me.id, 2000, new Date().toISOString()), 40);

  // а днес не вали и офертата е от вчера: изобщо не се вижда
  t.db.prepare('UPDATE activations SET activated_at = ? WHERE promotion_id = ?').run(yesterday, rain);
  t.state.now = 'clouds';
  assert.equal((await t.call('GET', '/api/promotions', null, t.token)).body.promotions.some((p) => p.id === rain), false);
});

test('управлението задава при какво време се показва оферта', async () => {
  const t = await setup('rain');
  const admin = (await t.call('POST', '/api/staff/login', { password: 'много-дълга-парола' })).body.token;
  const made = await t.call('POST', '/api/admin/promotions', { title: 'Чай в мъглата', kind: 'info', weather: 'fog' }, admin);
  assert.equal(made.status, 200);
  assert.equal(made.body.promotion?.weather ?? made.body.weather, 'fog');
  const bad = await t.call('POST', '/api/admin/promotions', { title: 'Градушка', kind: 'info', weather: 'hail' }, admin);
  assert.equal(bad.body.error, 'bad_weather');
  const plain = await t.call('POST', '/api/admin/promotions', { title: 'Без време', kind: 'info' }, admin);
  assert.equal(plain.body.promotion?.weather ?? plain.body.weather, '');
  const listed = (await t.call('GET', '/api/admin/promotions', null, admin)).body.promotions;
  assert.equal(listed.filter((p) => p.weather).length, 6);
});
