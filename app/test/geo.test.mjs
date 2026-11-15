// Разстоянията до магазините: формулата срещу познати разстояния и подреждането.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, formatDistance, byDistance, locate } from '../src/geo.ts';

const sofia = { lat: 42.6977, lng: 23.3219 }, varna = { lat: 43.2141, lng: 27.9147 }, plovdiv = { lat: 42.1354, lng: 24.7453 };

test('разстоянието по права линия съвпада с познатите', () => {
  // София – Варна е около 378 км, София – Пловдив около 132 км по права линия
  assert.ok(Math.abs(distanceKm(sofia, varna) - 378) < 4, String(distanceKm(sofia, varna)));
  assert.ok(Math.abs(distanceKm(sofia, plovdiv) - 132) < 3, String(distanceKm(sofia, plovdiv)));
  assert.equal(distanceKm(sofia, sofia), 0);
  assert.ok(Math.abs(distanceKm(sofia, varna) - distanceKm(varna, sofia)) < 1e-9);
  // една хилядна от градуса ширина е около 111 метра
  assert.ok(Math.abs(distanceKm(sofia, { lat: sofia.lat + 0.001, lng: sofia.lng }) - 0.111) < 0.002);
});

test('разстоянието се изписва в метри до километър и в километри нататък', () => {
  assert.equal(formatDistance(0.01), '50 м');
  assert.equal(formatDistance(0.34), '350 м');
  assert.equal(formatDistance(0.94), '950 м');
  assert.equal(formatDistance(0.96), '1,0 км');
  assert.equal(formatDistance(2.44), '2,4 км');
  assert.equal(formatDistance(9.96), '10 км');
  assert.equal(formatDistance(35.2), '35 км');
  assert.equal(formatDistance(378.4), '378 км');
});

test('магазините се подреждат от най-близкия; тези без координати са накрая', () => {
  const stores = [
    { id: 1, lat: sofia.lat, lng: sofia.lng }, { id: 2, lat: null, lng: null }, { id: 3, lat: varna.lat, lng: varna.lng }, { id: 4, lat: plovdiv.lat, lng: plovdiv.lng },
  ];
  const near = byDistance(stores, { lat: 43.2, lng: 27.9 });
  assert.deepEqual(near.map((s) => s.id), [3, 4, 1, 2]);
  assert.ok(near[0].km < 3);
  assert.equal(near[3].km, null);
  assert.deepEqual(stores.map((s) => s.id), [1, 2, 3, 4]); // подаденият списък не се пипа
});

test('без браузър с местоположение човекът получава ясно съобщение', async () => {
  await assert.rejects(() => locate(), /не дава местоположение/);
});
