// Локалният конектор на касата (connector/vamibex-pos-connector.mjs) срещу истинския сървър на клуба и пробна каса:
// страници, рестарт, прекъсната връзка, грешен ключ, събитие за преглед. Нищо не бива да се губи или да действа два пъти.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnector, fileState, backoffMs, ConnectorError } from '../../connector/vamibex-pos-connector.mjs';
import { setup, sale } from './pos-pomosht.js';

const POS = 'http://127.0.0.1:8766', KLUB = 'https://klub.primer.bg', POS_TOKEN = 'x'.repeat(40);

/**
 * Пробна каса с журнал от събития, която отговаря като локалния API на Vamibex POS (after, limit, next_cursor, has_more),
 * и връзка към сървъра на клуба. fail може да „скъса кабела“ към касата или към клуба.
 */
async function rig({ environment = 'production' } = {}) {
  const t = await setup();
  const journal = [];
  const net = { posDown: false, klubDown: false, klubFailOn: null, posCalls: [], klubCalls: [] };
  const json = (status, body) => ({ status, json: async () => body });
  const fetchImpl = async (url, options = {}) => {
    if (url.startsWith(POS)) {
      if (net.posDown) throw new Error('connect ECONNREFUSED 127.0.0.1:8766');
      net.posCalls.push(url);
      if (options.headers?.authorization !== `Bearer ${POS_TOKEN}`) return json(401, { error: 'unauthorized' });
      const q = new URL(url).searchParams, after = Number(q.get('after')), limit = Number(q.get('limit'));
      const rest = journal.filter((e) => e.sequence > after);
      const events = rest.slice(0, limit);
      return json(200, { environment, events, next_cursor: events.length ? events.at(-1).sequence : after, has_more: rest.length > limit });
    }
    const body = JSON.parse(options.body);
    if (net.klubDown || net.klubFailOn === body.event.id) throw new Error('fetch failed');
    net.klubCalls.push(body.event.id);
    const res = await t.app.inject({ method: 'POST', url: url.slice(KLUB.length), payload: body, headers: { authorization: options.headers.authorization } });
    return json(res.statusCode, JSON.parse(res.body));
  };
  const memory = () => { let s = {}; return { load: () => ({ ...s }), save: (v) => { s = { ...v }; }, peek: () => s }; };
  const connector = (state, over = {}) => createConnector({ posUrl: POS, posToken: POS_TOKEN, loyaltyUrl: KLUB, sourceId: t.east.source_id, sourceToken: t.east.token,
    state, limit: 2, fetchImpl, log: {}, ...over });
  /** Нови продажби в журнала на касата; между тях има пропуски в номерата, както при истинската */
  const ring = (count, cents = 1000) => { for (let i = 0; i < count; i++) journal.push(sale(t.ref, { sequence: (journal.at(-1)?.sequence ?? 0) + 3 }, { total_cents: cents })); };
  return { t, journal, net, memory, connector, ring };
}

test('конекторът чете на страници, праща всичко по ред и помни докъде е стигнал', async () => {
  const r = await rig();
  r.ring(5); // номера 3, 6, 9, 12, 15
  const state = r.memory(), c = r.connector(state);
  assert.deepEqual(await c.step(), { forwarded: 2, hasMore: true, cursor: 6 });
  assert.deepEqual(await c.step(), { forwarded: 2, hasMore: true, cursor: 12 });
  assert.deepEqual(await c.step(), { forwarded: 1, hasMore: false, cursor: 15 });
  assert.equal(r.t.points(), 50);
  assert.deepEqual(r.net.klubCalls, r.journal.map((e) => e.id));
  // няма нови продажби: курсорът остава, нищо не се праща
  assert.deepEqual(await c.step(), { forwarded: 0, hasMore: false, cursor: 15 });
  assert.equal(r.net.posCalls.at(-1), `${POS}/api/integrations/v1/events?after=15&limit=2`);
  assert.deepEqual(state.peek(), { cursor: 15, environment: 'production' });
  assert.equal(r.net.klubCalls.length, 5);
});

test('рестарт: с пазен напредък продължава оттам; с изгубен напредък праща наново, без точки втори път', async () => {
  const r = await rig();
  r.ring(3);
  const state = r.memory();
  await r.connector(state).step();
  // процесът е спрян и пуснат отново със същия файл
  const again = r.connector(state);
  assert.deepEqual(await again.step(), { forwarded: 1, hasMore: false, cursor: 9 });
  assert.equal(r.net.klubCalls.length, 3);
  assert.equal(r.t.points(), 30);
  // файлът с напредъка е изгубен (нов диск): всичко се праща пак, сървърът го разпознава като повторение
  const fresh = r.connector(r.memory());
  while ((await fresh.step()).hasMore);
  assert.equal(r.net.klubCalls.length, 6);
  assert.equal(r.t.points(), 30);
  assert.equal(r.t.db.prepare('SELECT COUNT(*) n FROM purchases').get().n, 3);
});

test('прекъсната връзка към клуба по средата на страница: курсорът остава на последното прието и после продължава', async () => {
  const r = await rig();
  r.ring(4); // 3, 6, 9, 12
  const state = r.memory(), c = r.connector(state, { limit: 4 });
  r.net.klubFailOn = r.journal[2].id;
  await assert.rejects(c.step(), (err) => err instanceof ConnectorError && err.where === 'loyalty');
  assert.equal(state.peek().cursor, 6); // първите две са приети
  assert.equal(r.t.points(), 20);
  // още един неуспешен опит не мести нищо
  await assert.rejects(c.step());
  assert.equal(state.peek().cursor, 6);
  r.net.klubFailOn = null;
  assert.deepEqual(await c.step(), { forwarded: 2, hasMore: false, cursor: 12 });
  assert.equal(r.t.points(), 40);
  // всяко събитие е стигнало до сървъра точно веднъж
  assert.deepEqual(r.net.klubCalls, r.journal.map((e) => e.id));
});

test('касата или клубът не отговарят, или ключът е грешен: курсорът се пази', async () => {
  const r = await rig();
  r.ring(2);
  const state = r.memory(), c = r.connector(state);
  r.net.posDown = true;
  await assert.rejects(c.step(), (err) => err.where === 'pos' && /не отговаря/.test(err.message));
  r.net.posDown = false;
  r.net.klubDown = true;
  await assert.rejects(c.step(), (err) => err.where === 'loyalty');
  r.net.klubDown = false;
  assert.deepEqual(state.peek(), {});
  // грешен ключ на касата
  await assert.rejects(r.connector(state, { posToken: 'greshen' }).step(), (err) => err.where === 'pos' && err.status === 401);
  // грешен ключ на инсталацията пред клуба
  await assert.rejects(r.connector(state, { sourceToken: 'greshen' }).step(), (err) => err.where === 'loyalty' && err.status === 401);
  assert.deepEqual(state.peek(), {});
  assert.equal(r.t.points(), 0);
  assert.deepEqual(await c.step(), { forwarded: 2, hasMore: false, cursor: 6 });
  assert.equal(r.t.points(), 20);
});

test('събитие с непозната версия се прибира за преглед на сървъра и не спира следващите', async () => {
  const r = await rig();
  r.ring(1);
  r.journal.push({ ...sale(r.t.ref, { sequence: 6 }), schema_version: 2 });
  r.ring(1);
  const c = r.connector(r.memory(), { limit: 10 });
  assert.deepEqual(await c.step(), { forwarded: 3, hasMore: false, cursor: 9 });
  assert.equal(r.t.points(), 20);
  assert.equal(r.t.db.prepare("SELECT COUNT(*) n FROM pos_events WHERE status = 'quarantined'").get().n, 1);
});

test('неочакван отговор от касата не мести курсора, а смяна на средата спира конектора', async () => {
  const r = await rig();
  r.ring(2);
  const state = r.memory();
  const broken = async () => ({ status: 200, json: async () => ({ events: 'ne e spisak' }) });
  await assert.rejects(r.connector(state, { fetchImpl: broken }).step(), /не е във вида/);
  const backwards = async () => ({ status: 200, json: async () => ({ environment: 'production', events: [], next_cursor: 1, has_more: false }) });
  state.save({ cursor: 6, environment: 'production' });
  await assert.rejects(r.connector(state, { fetchImpl: backwards }).step(), /по-малък от записания/);
  // касата е превключена от пробна на истинска среда: старият напредък не важи за новия журнал
  state.save({ cursor: 6, environment: 'simulation' });
  await assert.rejects(r.connector(state).step(), /Средата на касата се е сменила/);
  assert.equal(state.peek().cursor, 6);
  assert.equal(r.t.points(), 0);
});

test('пробната среда на касата отива в отделните пробни данни', async () => {
  const r = await rig({ environment: 'simulation' });
  r.ring(2);
  const state = r.memory();
  assert.deepEqual(await r.connector(state).step(), { forwarded: 2, hasMore: false, cursor: 6 });
  assert.equal(r.t.points(), 0); // истинските точки не са пипнати
  assert.equal(state.peek().environment, 'simulation');
});

test('напредъкът се пази във файл и оцелява при рестарт; повреден файл спира конектора, вместо да започне отначало', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'konektor-'));
  try {
    const path = join(dir, 'pod', 'napredak.json');
    const r = await rig();
    r.ring(3);
    assert.deepEqual(fileState(path).load(), {});
    await r.connector(fileState(path)).step();
    assert.equal(fileState(path).load().cursor, 6);
    assert.ok(!existsSync(path + '.tmp'));
    assert.deepEqual(await r.connector(fileState(path)).step(), { forwarded: 1, hasMore: false, cursor: 9 });
    writeFileSync(path, '{"cursor": 9, "envir');
    assert.throws(() => fileState(path).load(), /не се чете/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('цикълът: при още страници чете веднага, при грешка изчаква все по-дълго и после продължава', async () => {
  const r = await rig();
  r.ring(3);
  const waits = [], stop = new AbortController();
  r.net.klubDown = true;
  const sleep = async (ms) => {
    waits.push(ms);
    if (waits.length === 3) r.net.klubDown = false; // връзката се връща след третия неуспех
    if (waits.length === 5) stop.abort();
  };
  await r.connector(r.memory()).run({ pollMs: 3000, signal: stop.signal, sleep });
  // три изчаквания след грешка (около 1, 2 и 4 секунди), после две страници една след друга без чакане и почивка от 3 секунди
  assert.ok(waits[0] >= 750 && waits[0] <= 1250, String(waits[0]));
  assert.ok(waits[1] >= 1500 && waits[1] <= 2500, String(waits[1]));
  assert.ok(waits[2] >= 3000 && waits[2] <= 5000, String(waits[2]));
  assert.deepEqual(waits.slice(3), [3000, 3000]);
  assert.equal(r.t.points(), 30);
  assert.equal(backoffMs(0, () => 0.5), 1000);
  assert.equal(backoffMs(3, () => 0.5), 8000);
  assert.equal(backoffMs(50, () => 0.5), 60000); // най-много минута
});
