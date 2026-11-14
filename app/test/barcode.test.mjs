// Проверка на баркода: ивиците се разчитат обратно до същите 13 цифри.
// Разчитането тук е написано отделно от рисуването, за да хване грешка в таблиците.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ean13Bits, runs, groupCode } from '../src/barcode.ts';

// ширини на ивиците за всяка цифра в „ляв нечетен“ код (стандартът EAN/UPC), започва със светла ивица
const WIDTHS = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'];
const FIRST = { LLLLLL: 0, LLGLGG: 1, LLGGLG: 2, LLGGGL: 3, LGLLGG: 4, LGGLLG: 5, LGGGLL: 6, LGLGLG: 7, LGLGGL: 8, LGGLGL: 9 };

function decode(bits) {
  assert.equal(bits.length, 95);
  assert.equal(bits.slice(0, 3), '101');
  assert.equal(bits.slice(45, 50), '01010');
  assert.equal(bits.slice(92), '101');
  const widths = (chunk) => runs(chunk).join('');
  let parity = '', left = '', right = '';
  for (let i = 0; i < 6; i++) {
    const chunk = bits.slice(3 + i * 7, 10 + i * 7);
    assert.equal(chunk[0], '0'); // левите цифри започват със светла ивица
    const w = runs('1' + chunk).slice(1).join(''); // ширините на четирите ивици
    const asL = WIDTHS.indexOf(w), asG = WIDTHS.indexOf([...w].reverse().join(''));
    if (asL >= 0) { parity += 'L'; left += asL; } else { assert.ok(asG >= 0, `непозната цифра ${chunk}`); parity += 'G'; left += asG; }
  }
  for (let i = 0; i < 6; i++) {
    const chunk = bits.slice(50 + i * 7, 57 + i * 7);
    assert.equal(chunk[0], '1'); // десните цифри започват с тъмна ивица
    const digit = WIDTHS.indexOf(widths(chunk));
    assert.ok(digit >= 0, `непозната цифра ${chunk}`);
    right += digit;
  }
  assert.ok(parity in FIRST, `непозната подредба ${parity}`);
  return FIRST[parity] + left + right;
}

test('всеки код се разчита обратно до същите цифри', () => {
  for (const code of ['4006381333931', '2912345678905', '2900000000000', '2999999999999', '0123456789012', '5901234123457', '9780201379624']) {
    assert.equal(decode(ean13Bits(code)), code);
  }
  for (let i = 0; i < 300; i++) {
    const code = '29' + String(Math.floor(Math.random() * 1e11)).padStart(11, '0');
    assert.equal(decode(ean13Bits(code)), code);
  }
});

test('ивиците са общо 95 модула и започват и свършват с тъмна', () => {
  const r = runs(ean13Bits('2912345678905'));
  assert.equal(r.reduce((a, b) => a + b, 0), 95);
  assert.equal(r.length % 2, 1);
  assert.ok(r.every((n) => n >= 1 && n <= 4));
});

test('грешен код не се рисува', () => {
  assert.throws(() => ean13Bits('123'));
  assert.throws(() => ean13Bits('29123456789ab'));
  assert.equal(groupCode('2912345678905'), '2 912345 678905');
});
