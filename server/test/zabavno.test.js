// Проверки на забавната част: талони за изтриване след покупка и мисии с награда.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { createDemoKasa } from '../src/connectors/demo.js';
import * as core from '../src/core.js';

const base = { demo: true, adminPassword: 'admin-parola-123', kasaPin: '654321', pointsPerEuro: 1, cardPrefix: '29' };

async function setup(extra = {}) {
  const db = openDb(':memory:');
  const app = await buildApp({ db, config: { ...base, ...extra }, mail: { send: async () => {} }, kasa: createDemoKasa() });
  const call = async (method, url, body, token) => {
    const res = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  const login = async (email = 'maria@primer.bg') => {
    const r = await call('POST', '/api/auth/request-code', { email });
    return (await call('POST', '/api/auth/verify', { email, code: r.body.demoCode })).body;
  };
  const staff = async (password) => (await call('POST', '/api/staff/login', { password })).body.token;
  return { db, app, call, login, staff };
}

test('наградите за талоните: четене на настройката и теглене по тежест', () => {
  assert.deepEqual(core.parsePrizes('5:55, 10:30,20:12,50:3'), [{ points: 5, weight: 55 }, { points: 10, weight: 30 }, { points: 20, weight: 12 }, { points: 50, weight: 3 }]);
  assert.deepEqual(core.parsePrizes(''), []);
  for (const bad of ['5', '5:0', '0:5', 'а:б', '5:55;10:30']) assert.throws(() => core.parsePrizes(bad), bad);
  const prizes = core.parsePrizes('5:55,10:30,20:12,50:3');
  // границите на всяка награда: 0–54 → 5, 55–84 → 10, 85–96 → 20, 97–99 → 50
  const at = (n) => core.drawPrize(prizes, (max) => { assert.equal(max, 100); return n; });
  assert.deepEqual([0, 54, 55, 84, 85, 96, 97, 99].map(at), [5, 5, 10, 10, 20, 20, 50, 50]);
  // истинското теглене дава само позволени награди и по-малките се падат по-често
  const seen = { 5: 0, 10: 0, 20: 0, 50: 0 };
  for (let i = 0; i < 4000; i++) seen[core.drawPrize(prizes)]++;
  assert.ok(seen[5] > seen[10] && seen[10] > seen[20] && seen[20] > seen[50], JSON.stringify(seen));
});

test('талон: идва след покупка над минимума, печели веднъж и наградата не се вижда предварително', async () => {
  const t = await setup({ scratch: { minCents: 500, prizes: core.parsePrizes('10:1') } });
  const me = await t.login(), other = await t.login('drug@primer.bg');
  const kasa = await t.staff('654321');
  const buy = (totalCents) => t.call('POST', '/api/kasa/demo-purchase', { cardCode: me.me.cardCode, totalCents }, kasa);

  assert.equal((await buy(499)).body.scratchCard, false); // под минимума няма талон
  assert.equal((await buy(500)).body.scratchCard, true);
  assert.equal((await buy(1200)).body.scratchCard, true);
  assert.equal((await t.call('GET', '/api/me', null, me.token)).body.scratchCards, 2);
  assert.equal((await t.call('GET', '/api/me', null, me.token)).body.points, 4 + 5 + 12); // талоните още не са донесли точки

  const cards = (await t.call('GET', '/api/scratch', null, me.token)).body.cards;
  assert.equal(cards.length, 2);
  assert.ok(cards.every((c) => c.status === 'new' && c.prize === null)); // наградата е скрита

  assert.equal((await t.call('POST', `/api/scratch/${cards[0].id}/reveal`, null, other.token)).status, 404); // чужд талон
  const won = await t.call('POST', `/api/scratch/${cards[0].id}/reveal`, null, me.token);
  assert.equal(won.body.prize, 10);
  assert.equal(won.body.points, 31);
  assert.equal((await t.call('POST', `/api/scratch/${cards[0].id}/reveal`, null, me.token)).status, 409); // втори път не носи нищо
  assert.equal((await t.call('GET', '/api/me', null, me.token)).body.points, 31);

  const after = (await t.call('GET', '/api/scratch', null, me.token)).body.cards;
  assert.deepEqual(after.map((c) => [c.status, c.prize]), [['new', null], ['revealed', 10]]); // неизтритият е първи
  assert.equal(core.pointsHistory(t.db, me.me.id)[0].label, 'Талон за изтриване');
  assert.equal((await t.call('GET', '/api/scratch')).status, 401);
});

test('без настроени награди талони няма', async () => {
  const t = await setup();
  const me = await t.login();
  const kasa = await t.staff('654321');
  assert.equal((await t.call('POST', '/api/kasa/demo-purchase', { cardCode: me.me.cardCode, totalCents: 5000 }, kasa)).body.scratchCard, false);
  assert.equal((await t.call('GET', '/api/scratch', null, me.token)).body.cards.length, 0);
});

test('мисии: напредъкът расте с покупките и наградата идва веднъж', async () => {
  const t = await setup();
  const admin = await t.staff('admin-parola-123'), kasa = await t.staff('654321');
  const me = await t.login();
  const buy = (totalCents) => t.call('POST', '/api/kasa/demo-purchase', { cardCode: me.me.cardCode, totalCents }, kasa);

  const three = await t.call('POST', '/api/admin/challenges', { title: 'Три покупки', kind: 'purchases', goal: 3, reward_points: 50 }, admin);
  const spend = await t.call('POST', '/api/admin/challenges', { title: 'За 100 €', kind: 'spend', goal: 10000, reward_points: 100 }, admin);
  assert.equal(three.status, 200);
  assert.equal(spend.status, 200);
  await t.call('POST', '/api/admin/challenges', { title: 'Минала', kind: 'purchases', goal: 1, reward_points: 999, starts_at: '2020-01-01T00:00:00Z', ends_at: '2020-02-01T00:00:00Z' }, admin);
  await t.call('POST', '/api/admin/challenges', { title: 'Спряна', kind: 'purchases', goal: 1, reward_points: 999, active: false }, admin);

  const list = async () => (await t.call('GET', '/api/challenges', null, me.token)).body.challenges;
  assert.deepEqual((await list()).map((c) => [c.title, c.progress, c.done]), [['Три покупки', 0, false], ['За 100 €', 0, false]]);

  let r = await buy(3000);
  assert.deepEqual(r.body.completed, []);
  r = await buy(3000);
  assert.deepEqual((await list()).map((c) => [c.title, c.progress, c.done]), [['Три покупки', 2, false], ['За 100 €', 6000, false]]);
  r = await buy(2500);
  assert.deepEqual(r.body.completed.map((c) => c.title), ['Три покупки']);
  assert.equal(r.body.points, 30 + 30 + 25 + 50);
  r = await buy(2000);
  assert.deepEqual(r.body.completed.map((c) => c.title), ['За 100 €']);
  assert.equal(r.body.points, 85 + 50 + 20 + 100);
  r = await buy(9000); // и двете са изпълнени: нищо повече не идва
  assert.deepEqual(r.body.completed, []);
  assert.equal(r.body.points, 255 + 90);

  const done = await list();
  assert.ok(done.every((c) => c.done));
  assert.deepEqual(done.map((c) => c.progress), [3, 10000]); // напредъкът не минава целта
  assert.ok(core.pointsHistory(t.db, me.me.id).some((h) => h.label === 'Изпълнена мисия: Три покупки' && h.delta === 50));
  assert.equal((await t.call('GET', '/api/home', null, me.token)).body.challenges.length, 2);

  // друг клиент започва от нула
  const other = await t.login('drug@primer.bg');
  assert.deepEqual((await t.call('GET', '/api/challenges', null, other.token)).body.challenges.map((c) => c.progress), [0, 0]);
});

test('мисии: проверките хващат грешни стойности и само управлението ги пипа', async () => {
  const t = await setup();
  const admin = await t.staff('admin-parola-123'), kasa = await t.staff('654321');
  const post = (body, token = admin) => t.call('POST', '/api/admin/challenges', body, token);
  assert.equal((await post({ title: 'М', kind: 'purchases', goal: 3, reward_points: 50 })).body.error, 'bad_title');
  assert.equal((await post({ title: 'Мисия', kind: 'друго', goal: 3, reward_points: 50 })).body.error, 'bad_kind');
  assert.equal((await post({ title: 'Мисия', kind: 'purchases', goal: 0, reward_points: 50 })).body.error, 'bad_goal');
  assert.equal((await post({ title: 'Мисия', kind: 'purchases', goal: 3, reward_points: 0 })).body.error, 'bad_reward');
  assert.equal((await post({ title: 'Мисия', kind: 'purchases', goal: 3, reward_points: 5, starts_at: '2026-02-01T00:00:00Z', ends_at: '2026-01-01T00:00:00Z' })).body.error, 'bad_dates');
  assert.equal((await post({ title: 'Мисия', kind: 'purchases', goal: 3, reward_points: 50 }, kasa)).status, 401);
  const made = await post({ title: 'Мисия', kind: 'purchases', goal: 3, reward_points: 50 });
  const changed = await t.call('PUT', `/api/admin/challenges/${made.body.id}`, { ...made.body, goal: 5 }, admin);
  assert.equal(changed.body.goal, 5);
  assert.equal((await t.call('GET', '/api/admin/challenges', null, admin)).body.challenges[0].completions, 0);
});
