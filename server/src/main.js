// Пуска сървъра. Настройките идват от променливи на средата (вижте README.md).
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { createSms } from './sms.js';
import { createKasa } from './connectors/index.js';
import { seedDemo, seedStores } from './seed.js';
import { recordPurchase, getSetting, setSetting, nowIso } from './core.js';

const env = process.env;
const demo = env.DEMO === '1';
const config = {
  demo,
  port: Number(env.PORT || 4100),
  host: env.HOST || '127.0.0.1',
  dbPath: env.DB_PATH || (demo ? './data/demo.db' : './data/klub.db'),
  adminPassword: env.ADMIN_PASSWORD || (demo ? 'demo-admin' : ''),
  kasaPin: env.KASA_PIN || (demo ? '1234' : ''),
  pointsPerEuro: Number(env.POINTS_PER_EURO || 1),
  // точки за добре дошли и за рожден ден; 0 ги изключва
  welcomePoints: Number(env.WELCOME_POINTS || (demo ? 20 : 0)),
  birthdayPoints: Number(env.BIRTHDAY_POINTS || (demo ? 50 : 0)),
  cardPrefix: env.CARD_PREFIX || '29',
  corsOrigin: env.CORS_ORIGIN || (demo ? '*' : ''),
  trustProxy: env.TRUST_PROXY === '1',
  kasa: env.KASA || 'demo',
  yanak: { baseUrl: env.YANAK_URL || undefined, email: env.YANAK_EMAIL, username: env.YANAK_USERNAME },
  smsProvider: env.SMS_PROVIDER || 'demo',
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
  if (config.smsProvider === 'demo') problems.push('SMS_PROVIDER=demo не праща истински кодове; изберете доставчик или пуснете с DEMO=1');
  if (!Number.isInteger(config.pointsPerEuro) || config.pointsPerEuro < 1) problems.push('POINTS_PER_EURO трябва да е цяло число над нула');
  for (const k of ['welcomePoints', 'birthdayPoints']) if (!Number.isInteger(config[k]) || config[k] < 0) problems.push(`${k === 'welcomePoints' ? 'WELCOME_POINTS' : 'BIRTHDAY_POINTS'} трябва да е цяло число, 0 или повече`);
  if (!/^2\d$/.test(config.cardPrefix)) problems.push('CARD_PREFIX трябва да е от 20 до 29 (вътрешни баркодове)');
  if (problems.length) {
    console.error('Сървърът не тръгва:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
}

const db = openDb(config.dbPath);
if (demo && seedDemo(db)) console.log('Демо: добавих примерни промоции, награди и новини.');
if (seedStores(db)) console.log('Добавих списъка с магазините; поддържа се от управлението.');
const sms = createSms({ provider: config.smsProvider });
const kasa = createKasa(config);
const app = await buildApp({ db, config, sms, kasa });

// Ако касата може да дава продажбите си, теглим ги на всеки няколко минути.
async function sync() {
  try {
    const since = getSetting(db, 'sales_cursor', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const started = nowIso();
    const sales = await kasa.fetchSales(since);
    let added = 0;
    for (const s of sales) if (recordPurchase(db, { ...s, source: kasa.name }, { pointsPerEuro: config.pointsPerEuro }).duplicate === false) added++;
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
console.log(`Клубът слуша на http://${config.host}:${config.port}${demo ? ' (демо: кодовете за вход не се пращат, а се връщат в отговора)' : ''}; каса: ${kasa.name}`);
