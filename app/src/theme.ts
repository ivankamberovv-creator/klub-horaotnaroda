// Цветовете и шрифтовете са като на horaotnaroda.bg: бяло, зелено и червено, старопечатни заглавия.
export const colors = {
  bg: '#ffffff',
  paper: '#f3f8f5',
  ink: '#0f2e22',
  muted: '#4b6156',
  line: '#d3e1d8',
  lineStrong: '#b9cdc1',
  green: '#00785a',
  greenFlag: '#00966e',
  greenDeep: '#0b5a42',
  onGreenSoft: '#d6f5e8',
  red: '#d62612',
  redText: '#b81f0e',
  white: '#ffffff',
  disabledBg: '#e4ede8',
  // небето в лентата с времето; бял текст се чете върху всяко от тях (контраст над 4,5)
  skySun: '#1b74bd',
  skyClouds: '#5b7486',
  skyRain: '#3f5b70',
  skyFog: '#66757d',
  skySnow: '#44749c',
  skyNight: '#16324a',
  sun: '#ffd23f',
  cloud: '#eef3f6',
  cloudDark: '#c9d5dc',
  drop: '#bfe3ff',
};

export const fonts = {
  old: 'OldStandardTT_700Bold',
  body: 'GolosText_400Regular',
  medium: 'GolosText_500Medium',
  semi: 'GolosText_600SemiBold',
  bold: 'GolosText_700Bold',
};

export const radius = 4;

/** 1299 → „12,99 €“ */
export const euro = (cents: number) => (cents / 100).toFixed(2).replace('.', ',') + ' €';

const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
/** ISO → „14 ноември 2026“ (на ръка, за да е еднакво на всички телефони) */
export function day(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** ISO → „14 ноември, 18:05“ */
export function dayTime(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** 1 точка, 2 точки, 5 точки */
export const pointsWord = (n: number) => (Math.abs(n) === 1 ? 'точка' : 'точки');
