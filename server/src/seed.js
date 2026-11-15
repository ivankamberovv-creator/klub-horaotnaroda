// Примерни промоции и награди за демото. Не са истински: числата и условията ги решава собственикът.
import { readFileSync } from 'node:fs';
import { adminSavePromotion, adminSaveReward, adminSaveNews, adminSaveStore, adminSaveChallenge } from './core.js';

export function seedDemo(db) {
  if (db.prepare('SELECT COUNT(*) n FROM promotions').get().n || db.prepare('SELECT COUNT(*) n FROM rewards').get().n) return false;
  adminSavePromotion(db, { title: '+30 точки при покупка над 30 €', tag: 'Голяма покупка', kind: 'bonus_points', value: 30, min_total_cents: 3000,
    description: 'Добавят се към точките от самата покупка.' });
  adminSavePromotion(db, { title: 'Втори екстракт на половин цена', tag: 'Билкови екстракти', kind: 'info',
    description: 'При покупка на два билкови екстракта наведнъж.' });
  adminSavePromotion(db, { title: 'Двойни точки', tag: 'Събота и неделя', kind: 'double_points', value: 2,
    description: 'За всяка покупка през уикенда получавате два пъти повече точки.' });
  adminSavePromotion(db, { title: 'VITALUX Детокс с 20% отстъпка', tag: 'Тази седмица', kind: 'discount', value: 20,
    description: 'За едно шишенце от 20 мл, във всеки наш магазин.' });
  adminSaveReward(db, { title: 'Отстъпка 2 €', description: 'От следващата Ви покупка.', cost_points: 100 });
  adminSaveReward(db, { title: 'Отстъпка 5 €', description: 'От следващата Ви покупка.', cost_points: 250 });
  adminSaveReward(db, { title: 'Билков екстракт по избор', description: 'Едно шишенце от 20 мл.', cost_points: 400 });
  seedDemoMissions(db);
  adminSaveNews(db, { title: 'Добре дошли в клуба', body: 'Показвайте кода си на касата при всяка покупка и събирайте точки. Това е примерна новина: истинските се пишат от управлението.' });
  return true;
}

/** Примерни мисии за демото; добавят се и към по-стара демо база, която още няма мисии */
export function seedDemoMissions(db) {
  if (db.prepare('SELECT COUNT(*) n FROM challenges').get().n) return false;
  const month = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  adminSaveChallenge(db, { title: 'Три покупки този месец', description: 'Пазарувайте три пъти с картата си.', kind: 'purchases', goal: 3, reward_points: 50, ends_at: month });
  adminSaveChallenge(db, { title: 'Пазарувайте за 100 €', description: 'Общо за месеца, във всички наши магазини.', kind: 'spend', goal: 10000, reward_points: 100, ends_at: month });
  return true;
}

/**
 * Магазините при първо пускане: списъкът към 15.11.2026 (име, адрес, телефон, работно време).
 * След това се поддържат от управлението, раздел „Магазини“; този файл повече не се чете.
 */
export function seedStores(db) {
  if (db.prepare('SELECT COUNT(*) n FROM stores').get().n) return false;
  const stores = JSON.parse(readFileSync(new URL('./stores.seed.json', import.meta.url), 'utf8'));
  for (const s of stores) {
    adminSaveStore(db, { name: s.name, city: s.city, address: s.address, phone: s.phone, hours: s.hours, lat: s.geo?.[0] ?? null, lng: s.geo?.[1] ?? null });
  }
  return true;
}
