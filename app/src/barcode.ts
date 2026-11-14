// EAN-13: превръща 13-те цифри на кода в ивици. Връща дължините на редуващите се ивици,
// като първата е тъмна: [тъмна, светла, тъмна, …], общо 95 модула.

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
// първата цифра не се рисува: тя определя кои от левите шест цифри са с код L и кои с код G
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** 13 цифри → низ от 95 нули и единици (1 = тъмно) */
export function ean13Bits(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error('Кодът трябва да е от 13 цифри.');
  const parity = PARITY[Number(code[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[Number(code[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[Number(code[i])];
  return bits + '101';
}

/** Низ от нули и единици → дължини на ивиците, първата е тъмна */
export function runs(bits: string): number[] {
  const out: number[] = [];
  let last = '1', len = 0;
  for (const b of bits) {
    if (b === last) len++;
    else { out.push(len); last = b; len = 1; }
  }
  out.push(len);
  return out;
}

/** „2912345678901“ → „2 912345 678901“, както се пише под баркода */
export const groupCode = (code: string) => `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`;
