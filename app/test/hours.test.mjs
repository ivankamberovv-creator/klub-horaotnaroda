// Проверка на работното време: текстът и „отворено ли е сега“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursLines, openNow } from '../src/hours.ts';

const week = (a, b) => Array(7).fill([a, b]);

test('еднаквите дни се събират в един ред', () => {
  assert.deepEqual(hoursLines(week('8:00', '20:00')), ['Всеки ден 8:00–20:00']);
  assert.deepEqual(hoursLines('24/7'), ['Денонощно']);
  assert.deepEqual(hoursLines([['8:00', '19:00'], ['8:00', '19:00'], ['8:00', '19:00'], ['8:00', '19:00'], ['8:00', '19:00'], ['9:00', '14:00'], null]),
    ['Пон–Пет 8:00–19:00', 'Съб 9:00–14:00', 'Нед почивен ден']);
  assert.deepEqual(hoursLines([['8:00', '19:00'], '?', '?', ['8:00', '19:00'], ['8:00', '19:00'], null, null]),
    ['Пон 8:00–19:00', 'Вт–Ср уточнете по телефона', 'Чет–Пет 8:00–19:00', 'Съб–Нед почивен ден']);
  assert.deepEqual(hoursLines([]), []);
});

test('отворено ли е сега', () => {
  const h = [['8:00', '19:00'], ['8:00', '19:00'], ['8:00', '19:00'], ['8:00', '19:00'], ['8:00', '19:00'], '?', null];
  const at = (day, hh, mm = 0) => new Date(2026, 10, day, hh, mm); // ноември 2026: 16-и е понеделник
  assert.equal(openNow(h, at(16, 7, 59)), false);
  assert.equal(openNow(h, at(16, 8, 0)), true);
  assert.equal(openNow(h, at(16, 18, 59)), true);
  assert.equal(openNow(h, at(16, 19, 0)), false);
  assert.equal(openNow(h, at(21, 12)), null);  // събота: не е посочено
  assert.equal(openNow(h, at(22, 12)), false); // неделя: почивен ден
  assert.equal(openNow('24/7', at(22, 3)), true);
  // работа след полунощ
  const night = week('20:00', '2:00');
  assert.equal(openNow(night, at(16, 23)), true);
  assert.equal(openNow(night, at(16, 1)), true);
  assert.equal(openNow(night, at(16, 12)), false);
});
