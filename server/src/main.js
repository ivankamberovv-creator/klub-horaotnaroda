// Пуска сървъра. Настройките идват от променливи на средата (вижте README.md).
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { createMail } from './mail.js';
import { createWeather, WEATHER_KINDS } from './weather.js';
import { createKasa } from './connectors/index.js';
import { seedDemo, seedDemoMissions, seedDemoWeather, seedStores } from './seed.js';
import { recordPurchase, getSetting, setSetting, nowIso, parsePrizes } from './core.js';

const env = process.env;
// демото се пуска с DEMO=1 или с --demo (второто работи еднакво на Windows, macOS и Linux)
const args = process.argv.slice(2);
const demo = env.DEMO === '1' || args.includes('--demo');
// --lan отваря сървъра за другите устройства в мрежата, за проба от телефон
const lan = args.includes('--lan');
const config = {
  demo,
  port: Number(env.PORT || 4100),
  host: env.HOST || (lan ? '0.0.0.0' : '127.0.0.1'),
  dbPath: env.DB_PATH || (demo ? './data/demo.db' : './data/klub.db'),
  adminPassword: env.ADMIN_PASSWORD || (demo ? 'demo-admin' : ''),
  kasaPin: env.KASA_PIN || (demo ? '1234' : ''),
  pointsPerEuro: Number(env.POINTS_PER_EURO || 1),
  // точки за добре дошли и за рожден ден; 0 ги изключва
  welcomePoints: Number(env.WELCOME_POINTS || (demo ? 20 : 0)),
  birthdayPoints: Number(env.BIRTHDAY_POINTS || (demo ? 50 : 0)),
  // талони за изтриване: от каква покупка нагоре се дават и какво може да се падне („точки:тежест“); без награди няма талони
  scratch: { minCents: Math.round(Number(env.SCRATCH_MIN_EURO || (demo ? 5 : 0)) * 100), prizes: parsePrizes(env.SCRATCH_PRIZES ?? (demo ? '5:55,10:30,20:12,50:3' : '')) },
  cardPrefix: env.CARD_PREFIX || '29',
  corsOrigin: env.CORS_ORIGIN || (demo ? '*' : ''),
  trustProxy: env.TRUST_PROXY === '1',
  kasa: env.KASA || 'demo',
  yanak: { baseUrl: env.YANAK_URL || undefined, email: env.YANAK_EMAIL, username: env.YANAK_USERNAME },
  // времето навън: off, live (MET Norway; иска WEATHER_CONTACT), demo (сменя се през две минути) или sun, clouds, rain, fog, snow
  weather: { mode: env.WEATHER || (demo ? 'demo' : 'off'), contact: env.WEATHER_CONTACT || '' },
  // писмата с кода за вход: demo само ги печата, smtp ги праща през пощенска кутия на клуба
  mail: {
    provider: env.MAIL_PROVIDER || 'demo',
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465), user: env.SMTP_USER, pass: env.SMTP_PASS,
    from: env.MAIL_FROM || '',
  },
  syncMinutes: Number(env.SYNC_MINUTES || 5),
};
// качените снимки стоят до базата; готовото приложение (уеб вариантът) се взима от app/dist
config.uploadDir = resolve(env.UPLOAD_DIR || join(dirname(config.dbPath), 'uploads'));
config.appDir = resolve(env.APP_DIR || fileURLToPath(new URL('../../app/dist', import.meta.url)));

// Извън демото сървърът не тръгва с липсващи или слаби настройки.
if (!demo) {
  const problems = [];
  if (config.adminPassword.length < 12) problems.push('ADMIN_PASSWORD трябва да е поне 12 знака');
  if (config.kasaPin.length < 6) problems.push('KASA_PIN трябва да е поне 6 знака');
  if (config.adminPassword === config.kasaPin) problems.push('ADMIN_PASSWORD и KASA_PIN трябва да са различни');
  if (config.mail.provider !== 'smtp') problems.push('MAIL_PROVIDER трябва да е smtp: с demo кодовете за вход не се пращат (или пуснете с DEMO=1)');
  else {
    for (const [k, name] of [['host', 'SMTP_HOST'], ['user', 'SMTP_USER'], ['pass', 'SMTP_PASS'], ['from', 'MAIL_FROM']]) if (!config.mail[k]) problems.push(`${name} липсва (пощенската кутия, от която тръгват кодовете за вход)`);
    if (!Number.isInteger(config.mail.port) || config.mail.port < 1) problems.push('SMTP_PORT трябва да е число, обикновено 465 или 587');
  }
  if (!Number.isInteger(config.pointsPerEuro) || config.pointsPerEuro < 1) problems.push('POINTS_PER_EURO трябва да е цяло число над нула');
  for (const k of ['welcomePoints', 'birthdayPoints']) if (!Number.isInteger(config[k]) || config[k] < 0) problems.push(`${k === 'welcomePoints' ? 'WELCOME_POINTS' : 'BIRTHDAY_POINTS'} трябва да е цяло число, 0 или повече`);
  if (!/^2\d$/.test(config.cardPrefix)) problems.push('CARD_PREFIX трябва да е от 20 до 29 (вътрешни баркодове)');
  if (problems.length) {
    console.error('Сървърът не тръгва:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
}

// времето се проверява и в демото: грешна стойност трябва да се види веднага, а не като липсваща лента в приложението
if (!['off', 'live', 'demo', ...WEATHER_KINDS].includes(config.weather.mode)) {
  console.error(`Сървърът не тръгва:\n- WEATHER трябва да е off, live, demo или ${WEATHER_KINDS.join(', ')}`);
  process.exit(1);
}
if (config.weather.mode === 'live' && !config.weather.contact) {
  console.error('Сървърът не тръгва:\n- WEATHER=live иска WEATHER_CONTACT: имейл или сайт за връзка, който MET Norway изисква при всяко питане');
  process.exit(1);
}

const db = openDb(config.dbPath);
if (demo && seedDemo(db)) console.log('Демо: добавих примерни промоции, награди и новини.');
if (demo && seedDemoMissions(db)) console.log('Демо: добавих примерни мисии.');
if (demo && seedDemoWeather(db)) console.log('Демо: добавих примерни оферти според времето.');
if (seedStores(db)) console.log('Добавих списъка с магазините; поддържа се от управлението.');
const mail = createMail(config.mail);
const weather = createWeather(config.weather);
const kasa = createKasa(config);
const app = await buildApp({ db, config, mail, kasa, weather });

// Ако касата може да дава продажбите си, теглим ги на всеки няколко минути.
async function sync() {
  try {
    const since = getSetting(db, 'sales_cursor', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const started = nowIso();
    const sales = await kasa.fetchSales(since);
    let added = 0;
    for (const s of sales) if (recordPurchase(db, { ...s, source: kasa.name }, { pointsPerEuro: config.pointsPerEuro, scratch: config.scratch, welcomePoints: config.welcomePoints }).duplicate === false) added++;
    setSetting(db, 'sales_cursor', started);
    if (added) console.log(`Каса ${kasa.name}: ${added} нови покупки.`);
  } catch (err) {
    console.error(`Каса ${kasa.name}: тегленето на продажбите не мина:`, err.message);
  }
}
if (kasa.fetchSales) {
  sync();
  setInterval(sync, config.syncMinutes * 60_000).unref();
}

await app.listen({ port: config.port, host: config.host });
console.log(`Клубът слуша на http://${config.host}:${config.port}${demo ? ' (демо: писма с код за вход не се пращат, кодът се връща в отговора)' : ''}; каса: ${kasa.name}`);
if (config.host === '0.0.0.0') {
  // адресите, на които сървърът се вижда от телефон в същата мрежа
  const addresses = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => `http://${n.address}:${config.port}`);
  if (addresses.length) console.log('От телефон в същата мрежа: ' + addresses.join('  или  '));
}
