// Цялата логика на клуба: вход с имейл, кодове за касата, точки, промоции, награди и покупки.
// Функциите приемат базата като първи аргумент и не знаят нищо за HTTP.
import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

/** Грешка с код за приложението и текст за човека */
export class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

/** „ Ivan@Example.COM “ → „ivan@example.com“. Проверява само вида на адреса; дали съществува, показва кодът. Иначе null. */
export function normalizeEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) ? email : null;
}
const BAD_EMAIL = 'Въведете имейл адрес, например ime@primer.bg.';

/** Контролната цифра на EAN-13 за първите 12 цифри */
export function ean13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}
export const isValidEan13 = (code) => /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12];

/** Нов код за клиент: EAN-13 с префикс за вътрешна употреба (20–29) и 10 случайни цифри, за да не се отгатва чужд код. */
export function newCardCode(db, prefix = '29') {
  const exists = db.prepare('SELECT 1 FROM customers WHERE card_code = ?');
  for (;;) {
    const body = String(crypto.randomInt(0, 10 ** 10)).padStart(10, '0');
    const code = prefix + body + ean13CheckDigit(prefix + body);
    if (!exists.get(code)) return code;
  }
}

// ---- вход с имейл и еднократен код ----

const OTP_MINUTES = 10, OTP_MAX_ATTEMPTS = 5, OTP_PER_EMAIL = 3, OTP_PER_IP = 10, OTP_WINDOW_MIN = 15;

/** Създава еднократен код за адреса и го връща, за да бъде пратен. Ограничава броя искания. */
export function requestCode(db, rawEmail, ip = '') {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new AppError('bad_email', BAD_EMAIL);
  const since = new Date(Date.now() - OTP_WINDOW_MIN * 60_000).toISOString();
  const perEmail = db.prepare('SELECT COUNT(*) n FROM otp_requests WHERE email = ? AND at > ?').get(email, since).n;
  const perIp = ip ? db.prepare('SELECT COUNT(*) n FROM otp_requests WHERE ip = ? AND at > ?').get(ip, since).n : 0;
  if (perEmail >= OTP_PER_EMAIL || perIp >= OTP_PER_IP) {
    throw new AppError('too_many', `Поискахте твърде много кодове. Опитайте пак след ${OTP_WINDOW_MIN} минути.`, 429);
  }
  const code = String(crypto.randomInt(0, 10 ** 6)).padStart(6, '0');
  db.prepare('INSERT INTO otp_requests (email, ip, at) VALUES (?, ?, ?)').run(email, ip, nowIso());
  db.prepare('INSERT OR REPLACE INTO otp_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)')
    .run(email, sha(email + ':' + code), inMinutes(OTP_MINUTES));
  return { email, code };
}

/**
 * Проверява кода; при успех намира или създава клиента и отваря сесия.
 * Точките за добре дошли не се дават тук, а при първата покупка (вижте recordPurchase):
 * нов имейл се прави за минута и иначе един човек би си събрал подаръка много пъти.
 */
export function verifyCode(db, rawEmail, code, { cardPrefix = '29', sessionDays = 180 } = {}) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new AppError('bad_email', BAD_EMAIL);
  const row = db.prepare('SELECT * FROM otp_codes WHERE email = ?').get(email);
  if (!row || row.expires_at < nowIso()) throw new AppError('code_expired', 'Кодът е изтекъл. Поискайте нов.');
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new AppError('too_many_attempts', 'Твърде много грешни опити. Поискайте нов код.', 429);
  const given = Buffer.from(sha(email + ':' + String(code ?? '').trim()));
  if (!crypto.timingSafeEqual(given, Buffer.from(row.code_hash))) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?').run(email);
    throw new AppError('code_wrong', 'Кодът не е верен.');
  }
  return db.transaction(() => {
    db.prepare('DELETE FROM otp_codes WHERE email = ?').run(email);
    let customer = db.prepare('SELECT * FROM customers WHERE email = ?').get(email);
    const isNew = !customer;
    if (isNew) {
      const info = db.prepare('INSERT INTO customers (email, card_code, created_at) VALUES (?, ?, ?)')
        .run(email, newCardCode(db, cardPrefix), nowIso());
      customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
    }
    return { token: createSession(db, 'customer', customer.id, sessionDays * 24 * 60), customer, isNew };
  })();
}

export function createSession(db, role, customerId, minutes) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, role, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha(token), role, customerId ?? null, inMinutes(minutes), nowIso());
  return token;
}
export function getSession(db, token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha(token));
  return s && s.expires_at > nowIso() ? s : null;
}
export const dropSession = (db, token) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));

/** Вход за служители: паролата за управление дава роля admin, ПИН-ът на касата дава роля kasa. */
export function staffLogin(db, password, { adminPassword, kasaPin }) {
  // сравняват се отпечатъци, за да са еднакво дълги и сравнението да не издава нищо по времето си
  const same = (a, b) => Boolean(a && b) && crypto.timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));
  const given = String(password ?? '');
  const role = same(given, adminPassword) ? 'admin' : same(given, kasaPin) ? 'kasa' : null;
  if (!role) throw new AppError('bad_password', 'Грешна парола.', 401);
  return { role, token: createSession(db, role, null, 12 * 60) };
}

// ---- клиент ----

export const getCustomer = (db, id) => db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
export const getCustomerByCard = (db, code) => db.prepare('SELECT * FROM customers WHERE card_code = ?').get(String(code ?? '').trim());
export const balance = (db, customerId) =>
  db.prepare('SELECT COALESCE(SUM(delta), 0) n FROM points_ledger WHERE customer_id = ?').get(customerId).n;

export function setName(db, customerId, rawName) {
  const name = String(rawName ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60) throw new AppError('bad_name', 'Напишете името си (от 2 до 60 знака).');
  db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(name, customerId);
  return getCustomer(db, customerId);
}

/** „14.11“, „14.11.“, „14/11“ → „11-14“ (месец-ден); иначе null */
export function parseBirthday(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})[./-](\d{1,2})\.?$/);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]);
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!max || day < 1 || day > max) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/** „11-14“ → „14.11“ */
export const formatBirthday = (mmdd) => (mmdd ? `${mmdd.slice(3)}.${mmdd.slice(0, 2)}` : null);

/** Рожденият ден се записва само веднъж, за да не се сменя заради точките. */
export function setBirthday(db, customerId, raw) {
  const c = getCustomer(db, customerId);
  if (c.birthday) throw new AppError('birthday_set', 'Рожденият ден вече е записан. За промяна се обърнете към магазина.', 409);
  const birthday = parseBirthday(raw);
  if (!birthday) throw new AppError('bad_birthday', 'Напишете деня и месеца, например 14.11.');
  db.prepare('UPDATE customers SET birthday = ?, birthday_set_at = ? WHERE id = ?').run(birthday, nowIso(), customerId);
}

export function setFavoriteStore(db, customerId, storeId) {
  if (storeId !== null && !db.prepare('SELECT 1 FROM stores WHERE id = ? AND active = 1').get(storeId)) {
    throw new AppError('no_store', 'Няма такъв магазин.', 404);
  }
  db.prepare('UPDATE customers SET favorite_store_id = ? WHERE id = ?').run(storeId, customerId);
}

/** Днешната дата в България като { year, monthDay: „ММ-ДД“ } */
export function todayInSofia(now = new Date()) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now).split('-');
  return { year, monthDay: `${month}-${day}` };
}

const BIRTHDAY_WAIT_DAYS = 30;
/**
 * Точки за рожден ден: веднъж в годината, на самия ден. Дават се само ако рожденият ден е записан
 * поне 30 дни по-рано, за да не може някой да го запише „за днес“ и да вземе точките веднага.
 */
export function grantBirthdayBonus(db, customerId, points, now = new Date()) {
  if (!(points > 0)) return false;
  const c = getCustomer(db, customerId);
  const { year, monthDay } = todayInSofia(now);
  if (!c?.birthday || c.birthday !== monthDay) return false;
  if (new Date(c.birthday_set_at).getTime() > now.getTime() - BIRTHDAY_WAIT_DAYS * 24 * 60 * 60 * 1000) return false;
  const ref = `birthday-${year}`;
  if (db.prepare("SELECT 1 FROM points_ledger WHERE customer_id = ? AND reason = 'bonus' AND ref = ?").get(customerId, ref)) return false;
  db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, ?, 'bonus', ?, ?)")
    .run(customerId, points, ref, now.toISOString());
  return true;
}

/** Историята на точките: всяко начисляване и всяко харчене, с описание за човека */
export function pointsHistory(db, customerId, limit = 100) {
  const rows = db.prepare(`
    SELECT l.id, l.delta, l.reason, l.ref, l.created_at,
           CASE WHEN l.reason = 'purchase' THEN (SELECT shop FROM purchases p WHERE p.id = CAST(l.ref AS INTEGER)) END shop,
           CASE WHEN l.reason IN ('reward','reward_refund') THEN (SELECT reward_title FROM redemptions r WHERE r.id = CAST(l.ref AS INTEGER)) END reward,
           CASE WHEN l.reason = 'bonus' AND l.ref LIKE 'challenge-%' THEN (SELECT title FROM challenges ch WHERE ch.id = CAST(substr(l.ref, 11) AS INTEGER)) END challenge
    FROM points_ledger l WHERE l.customer_id = ? ORDER BY l.id DESC LIMIT ?`).all(customerId, limit);
  const label = (r) => (r.reason === 'purchase' ? `Покупка${r.shop ? ': ' + r.shop : ''}`
    : r.reason === 'reward' ? `Награда: ${r.reward ?? ''}`.trim()
      : r.reason === 'reward_refund' ? `Върнати точки: ${r.reward ?? ''}`.trim()
        : r.reason === 'bonus' ? (r.ref === 'welcome' ? 'Добре дошли в клуба' : String(r.ref).startsWith('birthday-') ? 'Честит рожден ден'
          : String(r.ref).startsWith('scratch-') ? 'Талон за изтриване' : String(r.ref).startsWith('challenge-') ? `Изпълнена мисия${r.challenge ? ': ' + r.challenge : ''}` : 'Подарък от клуба')
          : 'Корекция от магазина');
  return rows.map((r) => ({ id: r.id, delta: r.delta, label: label(r), at: r.created_at }));
}

/** Изтрива клиента и всичко за него (точки, покупки, сесии). Не може да се върне. */
export const deleteCustomer = (db, customerId) => db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);

// ---- промоции ----

const PROMO_VALID = `p.active = 1 AND (p.starts_at IS NULL OR p.starts_at <= @at) AND (p.ends_at IS NULL OR p.ends_at > @at)`;

/** Текущите промоции, с отметка коя е активирал клиентът */
export function listPromotions(db, customerId, at = nowIso()) {
  return db.prepare(`
    SELECT p.id, p.title, p.tag, p.description, p.kind, p.value, p.min_total_cents, p.ends_at, p.image_url,
           a.activated_at IS NOT NULL AS activated
    FROM promotions p LEFT JOIN activations a ON a.promotion_id = p.id AND a.customer_id = @customerId
    WHERE ${PROMO_VALID} ORDER BY p.id DESC`).all({ customerId, at }).map((p) => ({ ...p, activated: Boolean(p.activated) }));
}
export function activatePromotion(db, customerId, promotionId, at = nowIso()) {
  const p = db.prepare(`SELECT p.id FROM promotions p WHERE p.id = @id AND ${PROMO_VALID}`).get({ id: promotionId, at });
  if (!p) throw new AppError('no_promotion', 'Тази промоция вече не е активна.', 404);
  db.prepare('INSERT OR IGNORE INTO activations (customer_id, promotion_id, activated_at) VALUES (?, ?, ?)').run(customerId, promotionId, at);
}
export const deactivatePromotion = (db, customerId, promotionId) =>
  db.prepare('DELETE FROM activations WHERE customer_id = ? AND promotion_id = ?').run(customerId, promotionId);

/** Промоциите, които клиентът е активирал и които важат в момента `at` */
export function activePromotions(db, customerId, at = nowIso()) {
  return db.prepare(`
    SELECT p.id, p.title, p.kind, p.value, p.min_total_cents
    FROM promotions p JOIN activations a ON a.promotion_id = p.id AND a.customer_id = @customerId
    WHERE ${PROMO_VALID} ORDER BY p.id`).all({ customerId, at });
}

// ---- награди ----

export const listRewards = (db) =>
  db.prepare('SELECT id, title, description, cost_points FROM rewards WHERE active = 1 ORDER BY cost_points, id').all();

/** Разменя точки за награда: точките се взимат веднага, а наградата чака да бъде издадена на касата. */
export function redeemReward(db, customerId, rewardId) {
  return db.transaction(() => {
    const r = db.prepare('SELECT * FROM rewards WHERE id = ? AND active = 1').get(rewardId);
    if (!r) throw new AppError('no_reward', 'Тази награда вече не се предлага.', 404);
    const have = balance(db, customerId);
    if (have < r.cost_points) throw new AppError('not_enough_points', `Не достигат ${r.cost_points - have} точки.`, 409);
    const at = nowIso();
    const id = db.prepare(`INSERT INTO redemptions (customer_id, reward_id, reward_title, points, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)`).run(customerId, r.id, r.title, r.cost_points, at).lastInsertRowid;
    db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, ?, 'reward', ?, ?)")
      .run(customerId, -r.cost_points, String(id), at);
    return db.prepare('SELECT * FROM redemptions WHERE id = ?').get(id);
  })();
}
export const listRedemptions = (db, customerId) =>
  db.prepare('SELECT id, reward_title, points, status, created_at, resolved_at FROM redemptions WHERE customer_id = ? ORDER BY id DESC').all(customerId);

/** Касата издава наградата (issued) или я отказва (cancelled); при отказ точките се връщат. */
export function resolveRedemption(db, redemptionId, status) {
  return db.transaction(() => {
    const r = db.prepare('SELECT * FROM redemptions WHERE id = ?').get(redemptionId);
    if (!r) throw new AppError('no_redemption', 'Няма такава заявка за награда.', 404);
    if (r.status !== 'pending') throw new AppError('already_resolved', 'Тази награда вече е приключена.', 409);
    const at = nowIso();
    db.prepare('UPDATE redemptions SET status = ?, resolved_at = ? WHERE id = ?').run(status, at, r.id);
    if (status === 'cancelled') {
      db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, ?, 'reward_refund', ?, ?)")
        .run(r.customer_id, r.points, String(r.id), at);
    }
    return db.prepare('SELECT * FROM redemptions WHERE id = ?').get(r.id);
  })();
}

// ---- покупки и точки ----

/** Точките за покупка: по `pointsPerEuro` на всяко цяло евро, после активираните промоции (множител и точки отгоре). */
export function pointsFor(db, customerId, totalCents, at, pointsPerEuro = 1) {
  const base = Math.floor(totalCents / 100) * pointsPerEuro;
  let multiplier = 1, bonus = 0;
  for (const p of activePromotions(db, customerId, at)) {
    if (p.kind === 'double_points') multiplier = Math.max(multiplier, p.value);
    if (p.kind === 'bonus_points' && totalCents >= p.min_total_cents) bonus += p.value;
  }
  return base * multiplier + bonus;
}

/**
 * Записва покупка, дошла от касата, и начислява точките. Втори запис на същия документ не прави нищо.
 * p: { source, externalId, cardCode | customerId, shop, totalCents, discountCents, purchasedAt, items: [{ name, quantity, totalCents }] }
 */
export function recordPurchase(db, p, { pointsPerEuro = 1, scratch = null, welcomePoints = 0 } = {}) {
  return db.transaction(() => {
    const customer = p.customerId ? getCustomer(db, p.customerId) : getCustomerByCard(db, p.cardCode);
    if (!customer) return { skipped: 'unknown_customer' };
    const existing = db.prepare('SELECT * FROM purchases WHERE source = ? AND external_id = ?').get(p.source, String(p.externalId));
    if (existing) return { purchase: existing, duplicate: true };
    if (!Number.isInteger(p.totalCents) || p.totalCents < 0) throw new AppError('bad_total', 'Сумата на покупката не е вярна.');
    const at = p.purchasedAt || nowIso();
    const points = pointsFor(db, customer.id, p.totalCents, at, pointsPerEuro);
    const id = db.prepare(`INSERT INTO purchases (source, external_id, customer_id, shop, total_cents, discount_cents, points_earned, purchased_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.source, String(p.externalId), customer.id, p.shop || '', p.totalCents, p.discountCents || 0, points, at, nowIso()).lastInsertRowid;
    const addItem = db.prepare('INSERT INTO purchase_items (purchase_id, name, quantity, total_cents) VALUES (?, ?, ?, ?)');
    for (const it of p.items || []) addItem.run(id, String(it.name), Number(it.quantity) || 1, it.totalCents);
    if (points) {
      db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, ?, 'purchase', ?, ?)")
        .run(customer.id, points, String(id), nowIso());
    }
    // точките за добре дошли идват с първата покупка, веднъж
    if (welcomePoints > 0 && !db.prepare("SELECT 1 FROM points_ledger WHERE customer_id = ? AND reason = 'bonus' AND ref = 'welcome'").get(customer.id)) {
      db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, ?, 'bonus', 'welcome', ?)")
        .run(customer.id, welcomePoints, nowIso());
    }
    // забавната част: талон за изтриване и напредък по мисиите
    const scratchCard = createScratchCard(db, customer.id, id, p.totalCents, scratch);
    const completed = completeChallenges(db, customer.id, at);
    return { purchase: db.prepare('SELECT * FROM purchases WHERE id = ?').get(id), duplicate: false, scratchCard, completed };
  })();
}

export const listPurchases = (db, customerId, limit = 50) =>
  db.prepare(`SELECT id, shop, total_cents, discount_cents, points_earned, purchased_at FROM purchases
    WHERE customer_id = ? ORDER BY purchased_at DESC, id DESC LIMIT ?`).all(customerId, limit);

export function getPurchase(db, customerId, purchaseId) {
  const p = db.prepare(`SELECT id, shop, total_cents, discount_cents, points_earned, purchased_at FROM purchases
    WHERE id = ? AND customer_id = ?`).get(purchaseId, customerId);
  if (!p) throw new AppError('no_purchase', 'Няма такава покупка.', 404);
  return { ...p, items: db.prepare('SELECT name, quantity, total_cents FROM purchase_items WHERE purchase_id = ? ORDER BY id').all(p.id) };
}

/** Общо за клиента: брой покупки, похарчено и спестено от отстъпки */
export const purchaseTotals = (db, customerId) => db.prepare(`SELECT COUNT(*) count, COALESCE(SUM(total_cents), 0) total_cents,
  COALESCE(SUM(discount_cents), 0) discount_cents FROM purchases WHERE customer_id = ?`).get(customerId);

// ---- талони за изтриване ----

/** „5:55,10:30,20:12,50:3“ → [{ points, weight }]: точки и тежест (колко често се пада). Празно = няма талони. */
export function parsePrizes(textValue) {
  const prizes = String(textValue ?? '').split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [points, weight] = part.split(':').map(Number);
    if (!Number.isInteger(points) || points < 1 || !Number.isInteger(weight) || weight < 1) throw new Error(`Наградите за талоните не са верни: „${part}“. Очаква се „точки:тежест“, например 10:30.`);
    return { points, weight };
  });
  return prizes;
}

/** Тегли награда според тежестите; случайността е от системата, не от Math.random */
export function drawPrize(prizes, pick = (max) => crypto.randomInt(0, max)) {
  const total = prizes.reduce((sum, p) => sum + p.weight, 0);
  let n = pick(total);
  for (const p of prizes) {
    if (n < p.weight) return p.points;
    n -= p.weight;
  }
  return prizes[prizes.length - 1].points;
}

/** След покупка над минималната сума клиентът получава талон. Всеки талон печели; колко, се решава тук. */
function createScratchCard(db, customerId, purchaseId, totalCents, scratch) {
  if (!scratch || !scratch.prizes?.length || totalCents < (scratch.minCents ?? 0)) return null;
  const id = db.prepare("INSERT INTO scratch_cards (customer_id, purchase_id, prize_points, status, created_at) VALUES (?, ?, ?, 'new', ?)")
    .run(customerId, purchaseId, drawPrize(scratch.prizes), nowIso()).lastInsertRowid;
  return { id };
}

/** Талоните на клиента: неизтритите първи. Наградата се показва само на вече изтритите. */
export function listScratchCards(db, customerId, limit = 30) {
  return db.prepare(`SELECT s.id, s.status, s.created_at, s.revealed_at, s.prize_points, p.shop
    FROM scratch_cards s JOIN purchases p ON p.id = s.purchase_id
    WHERE s.customer_id = ? ORDER BY s.status = 'new' DESC, s.id DESC LIMIT ?`).all(customerId, limit)
    .map((s) => ({ id: s.id, status: s.status, shop: s.shop, created_at: s.created_at, revealed_at: s.revealed_at, prize: s.status === 'revealed' ? s.prize_points : null }));
}

/** Изтриване на талона: точките се начисляват веднага и само веднъж. */
export function revealScratchCard(db, customerId, cardId) {
  return db.transaction(() => {
    const card = db.prepare('SELECT * FROM scratch_cards WHERE id = ? AND customer_id = ?').get(cardId, customerId);
    if (!card) throw new AppError('no_scratch', 'Няма такъв талон.', 404);
    if (card.status === 'revealed') throw new AppError('already_revealed', 'Този талон вече е изтрит.', 409);
    const at = nowIso();
    db.prepare("UPDATE scratch_cards SET status = 'revealed', revealed_at = ? WHERE id = ?").run(at, card.id);
    db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, ?, 'bonus', ?, ?)")
      .run(customerId, card.prize_points, `scratch-${card.id}`, at);
    return { id: card.id, prize: card.prize_points, points: balance(db, customerId) };
  })();
}

// ---- мисии ----

const CHALLENGE_OPEN = 'ch.active = 1 AND ch.starts_at <= @at AND (ch.ends_at IS NULL OR ch.ends_at > @at)';

/** Докъде е стигнал клиентът по една мисия: брой покупки или похарчени евроцентове в срока ѝ */
function challengeProgress(db, customerId, ch) {
  const row = db.prepare(`SELECT COUNT(*) count, COALESCE(SUM(total_cents), 0) cents FROM purchases
    WHERE customer_id = ? AND purchased_at >= ? AND (? IS NULL OR purchased_at < ?)`).get(customerId, ch.starts_at, ch.ends_at, ch.ends_at);
  return ch.kind === 'purchases' ? row.count : row.cents;
}

/** Текущите мисии с напредъка на клиента; изпълнените остават видими, докато мисията тече */
export function listChallenges(db, customerId, at = nowIso()) {
  return db.prepare(`SELECT ch.*, c.completed_at FROM challenges ch
    LEFT JOIN challenge_completions c ON c.challenge_id = ch.id AND c.customer_id = @customerId
    WHERE ${CHALLENGE_OPEN} ORDER BY c.completed_at IS NOT NULL, ch.ends_at IS NULL, ch.ends_at, ch.id`).all({ customerId, at })
    .map((ch) => ({ id: ch.id, title: ch.title, description: ch.description, kind: ch.kind, goal: ch.goal, reward_points: ch.reward_points, ends_at: ch.ends_at,
      progress: Math.min(ch.goal, challengeProgress(db, customerId, ch)), done: Boolean(ch.completed_at) }));
}

/** След всяка покупка: мисиите, чиято цел вече е стигната, се приключват и носят точките си (всяка само веднъж). */
function completeChallenges(db, customerId, at) {
  const open = db.prepare(`SELECT ch.* FROM challenges ch
    WHERE ${CHALLENGE_OPEN} AND NOT EXISTS (SELECT 1 FROM challenge_completions c WHERE c.challenge_id = ch.id AND c.customer_id = @customerId)`).all({ customerId, at });
  const done = [];
  for (const ch of open) {
    if (challengeProgress(db, customerId, ch) < ch.goal) continue;
    const now = nowIso();
    db.prepare('INSERT INTO challenge_completions (challenge_id, customer_id, completed_at) VALUES (?, ?, ?)').run(ch.id, customerId, now);
    db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, ?, 'bonus', ?, ?)").run(customerId, ch.reward_points, `challenge-${ch.id}`, now);
    done.push({ id: ch.id, title: ch.title, reward_points: ch.reward_points });
  }
  return done;
}

export const adminListChallenges = (db) => db.prepare(`SELECT ch.*, (SELECT COUNT(*) FROM challenge_completions c WHERE c.challenge_id = ch.id) completions
  FROM challenges ch ORDER BY ch.id DESC`).all();
export function adminSaveChallenge(db, body, id = null) {
  const title = text(body.title, 80);
  if (title.length < 2) throw new AppError('bad_title', 'Напишете заглавие на мисията.');
  if (body.kind !== 'purchases' && body.kind !== 'spend') throw new AppError('bad_kind', 'Изберете вид на мисията.');
  const goal = Number(body.goal), reward = Number(body.reward_points);
  if (!Number.isInteger(goal) || goal < 1 || goal > 10_000_000) throw new AppError('bad_goal', body.kind === 'purchases' ? 'Броят покупки трябва да е цяло число над нула.' : 'Сумата на мисията не е вярна.');
  if (!Number.isInteger(reward) || reward < 1 || reward > 100_000) throw new AppError('bad_reward', 'Точките за мисията трябва да са цяло число над нула.');
  const starts = isoOrNull(body.starts_at) ?? nowIso(), ends = isoOrNull(body.ends_at);
  if (ends && ends <= starts) throw new AppError('bad_dates', 'Краят трябва да е след началото.');
  const f = { title, description: text(body.description, 300), kind: body.kind, goal, reward_points: reward, starts_at: starts, ends_at: ends,
    active: body.active === false || body.active === 0 ? 0 : 1 };
  if (id === null) {
    id = db.prepare(`INSERT INTO challenges (title, description, kind, goal, reward_points, starts_at, ends_at, active, created_at)
      VALUES (@title, @description, @kind, @goal, @reward_points, @starts_at, @ends_at, @active, @created_at)`).run({ ...f, created_at: nowIso() }).lastInsertRowid;
  } else {
    const done = db.prepare(`UPDATE challenges SET title=@title, description=@description, kind=@kind, goal=@goal, reward_points=@reward_points,
      starts_at=@starts_at, ends_at=@ends_at, active=@active WHERE id=@id`).run({ ...f, id });
    if (!done.changes) throw new AppError('no_challenge', 'Няма такава мисия.', 404);
  }
  return db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
}

// ---- обобщение за приложението и за касата ----

/** Всичко за началния екран на приложението */
export function customerSummary(db, customerId, { pointsPerEuro = 1, welcomePoints = 0 } = {}) {
  const c = getCustomer(db, customerId);
  const points = balance(db, customerId);
  const next = listRewards(db).find((r) => r.cost_points > points);
  return {
    id: c.id, name: c.name, email: c.email, cardCode: c.card_code, points, pointsPerEuro,
    // подаръкът за добре дошли, който още чака първата покупка; 0, ако няма такъв или вече е даден
    welcomePoints: welcomePoints > 0 && !db.prepare("SELECT 1 FROM points_ledger WHERE customer_id = ? AND reason = 'bonus' AND ref = 'welcome'").get(customerId) ? welcomePoints : 0,
    birthday: formatBirthday(c.birthday), favoriteStoreId: c.favorite_store_id ?? null, unreadNews: unreadNews(db, c),
    scratchCards: db.prepare("SELECT COUNT(*) n FROM scratch_cards WHERE customer_id = ? AND status = 'new'").get(customerId).n,
    nextReward: next ? { title: next.title, costPoints: next.cost_points, missing: next.cost_points - points } : null,
    activePromotions: activePromotions(db, customerId).length,
    pendingRewards: db.prepare("SELECT COUNT(*) n FROM redemptions WHERE customer_id = ? AND status = 'pending'").get(customerId).n,
  };
}

/** „ivan.petrov@gmail.com“ → „iv…@gmail.com“: касиерът вижда достатъчно, за да познае клиента, но не целия адрес */
export const maskEmail = (email) => {
  const at = email.lastIndexOf('@');
  return email.slice(0, Math.min(2, at)) + '…' + email.slice(at);
};

/** Какво вижда касиерът, когато сканира кода на клиента */
export function kasaLookup(db, cardCode) {
  const c = getCustomerByCard(db, cardCode);
  if (!c) throw new AppError('no_customer', 'Няма клиент с такъв код.', 404);
  return {
    customer: { id: c.id, name: c.name, cardCode: c.card_code, emailHint: maskEmail(c.email) },
    points: balance(db, c.id),
    promotions: activePromotions(db, c.id),
    pendingRewards: db.prepare("SELECT id, reward_title, points, created_at FROM redemptions WHERE customer_id = ? AND status = 'pending' ORDER BY id").all(c.id),
  };
}

// ---- управление ----

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isoOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new AppError('bad_date', 'Датата не е вярна.');
  return d.toISOString();
};
/** Снимка: празно, качена тук (/uploads/…) или адрес с https */
const imageUrl = (v) => {
  const url = String(v ?? '').trim();
  if (url && !/^\/uploads\/[a-z0-9]+\.(jpg|png|webp)$/.test(url) && !/^https:\/\/[^\s]+$/.test(url)) throw new AppError('bad_image', 'Снимката не е вярна. Качете я отново.');
  return url.slice(0, 300);
};
const KIND_RANGE = { discount: [1, 90], double_points: [2, 5], bonus_points: [1, 10000], info: [0, 0] };

function promotionFields(b) {
  const title = text(b.title, 80);
  if (title.length < 2) throw new AppError('bad_title', 'Напишете заглавие на промоцията.');
  const range = KIND_RANGE[b.kind];
  if (!range) throw new AppError('bad_kind', 'Изберете вид на промоцията.');
  const value = b.kind === 'info' ? 0 : Number(b.value);
  if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
    throw new AppError('bad_value', `Стойността трябва да е цяло число от ${range[0]} до ${range[1]}.`);
  }
  const minTotal = Number(b.min_total_cents ?? 0);
  if (!Number.isInteger(minTotal) || minTotal < 0) throw new AppError('bad_min_total', 'Минималната сума не е вярна.');
  const starts = isoOrNull(b.starts_at), ends = isoOrNull(b.ends_at);
  if (starts && ends && ends <= starts) throw new AppError('bad_dates', 'Краят трябва да е след началото.');
  return { title, tag: text(b.tag, 40), description: text(b.description, 300), kind: b.kind, value, min_total_cents: minTotal,
    starts_at: starts, ends_at: ends, active: b.active === false || b.active === 0 ? 0 : 1, image_url: imageUrl(b.image_url) };
}
export const adminListPromotions = (db) => db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM activations a WHERE a.promotion_id = p.id) activations
  FROM promotions p ORDER BY p.id DESC`).all();
export function adminSavePromotion(db, body, id = null) {
  const f = promotionFields(body);
  if (id === null) {
    id = db.prepare(`INSERT INTO promotions (title, tag, description, kind, value, min_total_cents, starts_at, ends_at, active, image_url, created_at)
      VALUES (@title, @tag, @description, @kind, @value, @min_total_cents, @starts_at, @ends_at, @active, @image_url, @created_at)`).run({ ...f, created_at: nowIso() }).lastInsertRowid;
  } else {
    const done = db.prepare(`UPDATE promotions SET title=@title, tag=@tag, description=@description, kind=@kind, value=@value,
      min_total_cents=@min_total_cents, starts_at=@starts_at, ends_at=@ends_at, active=@active, image_url=@image_url WHERE id=@id`).run({ ...f, id });
    if (!done.changes) throw new AppError('no_promotion', 'Няма такава промоция.', 404);
  }
  return db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
}

function rewardFields(b) {
  const title = text(b.title, 80);
  if (title.length < 2) throw new AppError('bad_title', 'Напишете име на наградата.');
  const cost = Number(b.cost_points);
  if (!Number.isInteger(cost) || cost < 1 || cost > 1_000_000) throw new AppError('bad_cost', 'Точките трябва да са цяло число над нула.');
  return { title, description: text(b.description, 300), cost_points: cost, active: b.active === false || b.active === 0 ? 0 : 1 };
}
export const adminListRewards = (db) => db.prepare('SELECT * FROM rewards ORDER BY cost_points, id').all();
export function adminSaveReward(db, body, id = null) {
  const f = rewardFields(body);
  if (id === null) {
    id = db.prepare('INSERT INTO rewards (title, description, cost_points, active, created_at) VALUES (@title, @description, @cost_points, @active, @created_at)')
      .run({ ...f, created_at: nowIso() }).lastInsertRowid;
  } else {
    const done = db.prepare('UPDATE rewards SET title=@title, description=@description, cost_points=@cost_points, active=@active WHERE id=@id').run({ ...f, id });
    if (!done.changes) throw new AppError('no_reward', 'Няма такава награда.', 404);
  }
  return db.prepare('SELECT * FROM rewards WHERE id = ?').get(id);
}

export function adminListCustomers(db, q = '', limit = 100) {
  const like = '%' + String(q).trim() + '%';
  return db.prepare(`SELECT c.id, c.name, c.email, c.card_code, c.created_at,
      (SELECT COALESCE(SUM(delta), 0) FROM points_ledger l WHERE l.customer_id = c.id) points,
      (SELECT COUNT(*) FROM purchases p WHERE p.customer_id = c.id) purchases,
      (SELECT COALESCE(SUM(total_cents), 0) FROM purchases p WHERE p.customer_id = c.id) spent_cents
    FROM customers c WHERE c.name LIKE @like OR c.email LIKE @like OR c.card_code LIKE @like
    ORDER BY c.id DESC LIMIT @limit`).all({ like, limit });
}
export const adminStats = (db) => ({
  customers: db.prepare('SELECT COUNT(*) n FROM customers').get().n,
  purchases: db.prepare('SELECT COUNT(*) n FROM purchases').get().n,
  turnoverCents: db.prepare('SELECT COALESCE(SUM(total_cents), 0) n FROM purchases').get().n,
  pointsOutstanding: db.prepare('SELECT COALESCE(SUM(delta), 0) n FROM points_ledger').get().n,
  pendingRewards: db.prepare("SELECT COUNT(*) n FROM redemptions WHERE status = 'pending'").get().n,
});

// ---- магазини ----

const storeOut = (s) => ({ id: s.id, name: s.name, city: s.city, address: s.address, phone: s.phone, hours: JSON.parse(s.hours),
  lat: s.lat, lng: s.lng, ...(s.active === undefined ? {} : { active: s.active }) });
export const listStores = (db) => db.prepare('SELECT id, name, city, address, phone, hours, lat, lng FROM stores WHERE active = 1 ORDER BY city, name').all().map(storeOut);
export const adminListStores = (db) => db.prepare('SELECT * FROM stores ORDER BY city, name').all().map(storeOut);

const HOUR = /^([01]?\d|2[0-3]):[0-5]\d$/;
function storeFields(b) {
  const name = text(b.name, 80);
  if (name.length < 2) throw new AppError('bad_name', 'Напишете име на магазина.');
  let hours = b.hours ?? [];
  const okDay = (d) => d === null || d === '?' || (Array.isArray(d) && d.length === 2 && HOUR.test(d[0]) && HOUR.test(d[1]));
  if (hours !== '24/7' && !(Array.isArray(hours) && (hours.length === 0 || hours.length === 7) && hours.every(okDay))) {
    throw new AppError('bad_hours', 'Работното време не е вярно: трябват седем дни, всеки с начало и край (например 8:00 и 20:00).');
  }
  const coord = (v, max) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || Math.abs(n) > max) throw new AppError('bad_geo', 'Координатите не са верни.');
    return n;
  };
  const phone = text(b.phone, 20);
  if (phone && !/^\+?[\d ]{6,20}$/.test(phone)) throw new AppError('bad_phone', 'Телефонът на магазина не е верен.');
  return { name, city: text(b.city, 60), address: text(b.address, 160), phone, hours: JSON.stringify(hours),
    lat: coord(b.lat, 90), lng: coord(b.lng, 180), active: b.active === false || b.active === 0 ? 0 : 1 };
}
export function adminSaveStore(db, body, id = null) {
  const f = storeFields(body);
  if (id === null) {
    id = db.prepare(`INSERT INTO stores (name, city, address, phone, hours, lat, lng, active, created_at)
      VALUES (@name, @city, @address, @phone, @hours, @lat, @lng, @active, @created_at)`).run({ ...f, created_at: nowIso() }).lastInsertRowid;
  } else {
    const done = db.prepare('UPDATE stores SET name=@name, city=@city, address=@address, phone=@phone, hours=@hours, lat=@lat, lng=@lng, active=@active WHERE id=@id').run({ ...f, id });
    if (!done.changes) throw new AppError('no_store', 'Няма такъв магазин.', 404);
  }
  return storeOut(db.prepare('SELECT * FROM stores WHERE id = ?').get(id));
}

// ---- новини ----

const NEWS_VISIBLE = 'active = 1 AND published_at <= ?';
export const listNews = (db, limit = 30, at = nowIso()) =>
  db.prepare(`SELECT id, title, body, image_url, published_at FROM news WHERE ${NEWS_VISIBLE} ORDER BY published_at DESC, id DESC LIMIT ?`).all(at, limit);
/** Колко новини са излезли, откакто клиентът за последно е отварял раздела */
export function unreadNews(db, customer, at = nowIso()) {
  return db.prepare(`SELECT COUNT(*) n FROM news WHERE ${NEWS_VISIBLE} AND published_at > ?`).get(at, customer.news_seen_at ?? customer.created_at).n;
}
export const markNewsSeen = (db, customerId) => db.prepare('UPDATE customers SET news_seen_at = ? WHERE id = ?').run(nowIso(), customerId);
export const adminListNews = (db) => db.prepare('SELECT * FROM news ORDER BY published_at DESC, id DESC').all();
export function adminSaveNews(db, body, id = null) {
  const title = text(body.title, 100);
  if (title.length < 2) throw new AppError('bad_title', 'Напишете заглавие на новината.');
  const f = { title, body: String(body.body ?? '').trim().slice(0, 2000), image_url: imageUrl(body.image_url),
    published_at: isoOrNull(body.published_at) ?? nowIso(), active: body.active === false || body.active === 0 ? 0 : 1 };
  if (id === null) {
    id = db.prepare('INSERT INTO news (title, body, image_url, published_at, active, created_at) VALUES (@title, @body, @image_url, @published_at, @active, @created_at)')
      .run({ ...f, created_at: nowIso() }).lastInsertRowid;
  } else {
    const done = db.prepare('UPDATE news SET title=@title, body=@body, image_url=@image_url, published_at=@published_at, active=@active WHERE id=@id').run({ ...f, id });
    if (!done.changes) throw new AppError('no_news', 'Няма такава новина.', 404);
  }
  return db.prepare('SELECT * FROM news WHERE id = ?').get(id);
}

/** Началният екран на приложението с една заявка */
export function home(db, customerId, opts = {}) {
  return {
    me: customerSummary(db, customerId, opts),
    offers: listPromotions(db, customerId).slice(0, 8),
    lastPurchase: listPurchases(db, customerId, 1)[0] ?? null,
    news: listNews(db, 3),
    challenges: listChallenges(db, customerId),
  };
}

// ---- настройки (малки стойности, които сървърът помни между пусканията) ----
export const getSetting = (db, key, fallback = null) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
export const setSetting = (db, key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
