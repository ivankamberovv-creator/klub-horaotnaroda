// Връзката с касовата програма Vamibex POS: приемане на продажбите ѝ, проверка на членство и награди на касата.
// Договорът е описан в docs/vamibex-pos.md и docs/openapi-loyalty-v1.json. Тук няма HTTP: функциите приемат базата.
//
// Основните правила:
//   - всяко събитие действа точно веднъж (уникално по търговец и номер на събитието в базата на своята среда);
//   - клиентът е един за всички магазини: намира се по постоянния си код (customer_ref) или по код на негова карта;
//   - точките са в книгата (points_ledger): резервацията на награда ги взима веднага, освобождаването ги връща с нов запис.
import crypto from 'node:crypto';
import { AppError, nowIso, balance, findMember, getCustomer, recordPurchase } from './core.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const inMinutes = (m, from = Date.now()) => new Date(from + m * 60_000).toISOString();

/** Име на среда: simulation, production… */
export const ENV_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/** Код на търговец, магазин, каса или инсталация */
const CODE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
/** customer_ref, както го приема касата */
const REF_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Номер на събитие, продажба, връщане: видими знаци без интервали */
const ID_RE = /^[\x21-\x7e]{1,200}$/;
const MAX_CENTS = 100_000_000;
const isCents = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_CENTS;
const isoOrNull = (v) => {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ---- инсталациите на каси (source_id) ----

const newToken = () => crypto.randomBytes(32).toString('base64url');

/** Нова инсталация. Ключът се връща само сега; в базата остава отпечатъкът му. */
export function createSource(db, rawId, note = '') {
  const sourceId = String(rawId ?? '').trim();
  if (!CODE_RE.test(sourceId)) throw new AppError('bad_source_id', 'Името на инсталацията може да съдържа латински букви, цифри, точка, тире и долна черта (до 64 знака).');
  if (db.prepare('SELECT 1 FROM pos_sources WHERE source_id = ?').get(sourceId)) throw new AppError('source_exists', 'Вече има инсталация с това име.', 409);
  const token = newToken();
  db.prepare('INSERT INTO pos_sources (source_id, token_hash, note, created_at) VALUES (?, ?, ?, ?)').run(sourceId, sha(token), String(note ?? '').trim().slice(0, 200), nowIso());
  return { source_id: sourceId, token };
}
/** Нов ключ за съществуваща инсталация; старият спира да важи веднага. */
export function rotateSourceToken(db, sourceId) {
  const token = newToken();
  if (!db.prepare('UPDATE pos_sources SET token_hash = ? WHERE source_id = ?').run(sha(token), sourceId).changes) throw new AppError('no_source', 'Няма такава инсталация.', 404);
  return { source_id: sourceId, token };
}
export function setSourceActive(db, sourceId, active) {
  if (!db.prepare('UPDATE pos_sources SET active = ? WHERE source_id = ?').run(active ? 1 : 0, sourceId).changes) throw new AppError('no_source', 'Няма такава инсталация.', 404);
}
export const listSources = (db) => db.prepare('SELECT source_id, note, active, created_at, last_seen_at, last_sequence FROM pos_sources ORDER BY source_id').all();
/** Коя инсталация пита; null при непознат или спрян ключ */
export function sourceByToken(db, token) {
  if (!token) return null;
  return db.prepare('SELECT source_id FROM pos_sources WHERE token_hash = ? AND active = 1').get(sha(String(token))) ?? null;
}
export function touchSource(db, sourceId, sequence = null) {
  db.prepare(`UPDATE pos_sources SET last_seen_at = ?, last_sequence = CASE WHEN ? IS NULL THEN last_sequence
    ELSE MAX(COALESCE(last_sequence, 0), ?) END WHERE source_id = ?`).run(nowIso(), sequence, sequence, sourceId);
}

// ---- правила за начисляване ----

/** „ALC-*,TOB-01“ → списък; звездичка накрая значи „започва с“ */
export function parseSkuList(textValue) {
  return String(textValue ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
const skuExcluded = (sku, patterns) => patterns.some((p) => (p.endsWith('*') ? sku.startsWith(p.slice(0, -1)) : sku === p));

/** Върху каква сума се смятат точките: без артикулите, които не носят точки, и нула под минималната покупка */
export function pointsBaseCents(totalCents, items, earn = {}) {
  if (totalCents < (earn.minTotalCents ?? 0)) return 0;
  const excluded = (earn.excludedSkus?.length ? items : []).filter((it) => skuExcluded(it.sku, earn.excludedSkus)).reduce((sum, it) => sum + it.total_cents, 0);
  return Math.max(0, Math.min(totalCents, totalCents - excluded));
}

// ---- приемане на събития ----

/** Проверява събитието; връща null, ако е наред, иначе причината за карантина. */
function problemWith(ev, cfg) {
  if (ev.type !== 'sale.completed' && ev.type !== 'sale.refunded') return 'unknown_type';
  if (ev.schema_version !== 1) return 'unknown_schema_version';
  if (ev.retailer_code !== cfg.retailerCode) return 'unknown_retailer';
  if (!CODE_RE.test(ev.store_code ?? '') || !CODE_RE.test(ev.register_code ?? '')) return 'bad_store_or_register';
  if (ev.sequence !== undefined && !(Number.isInteger(ev.sequence) && ev.sequence >= 0)) return 'bad_sequence';
  if (!isoOrNull(ev.occurred_at)) return 'bad_occurred_at';
  const d = ev.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'bad_data';
  if (d.customer_ref !== undefined && d.customer_ref !== null && !REF_RE.test(String(d.customer_ref))) return 'bad_customer_ref';
  if (ev.type === 'sale.completed') {
    if (typeof d.sale_id !== 'string' || !ID_RE.test(d.sale_id)) return 'bad_sale_id';
    if (d.currency !== 'EUR') return 'unsupported_currency';
    if (!isCents(d.total_cents)) return 'bad_total';
    if (!Array.isArray(d.items) || d.items.length > 2000) return 'bad_items';
    for (const it of d.items) {
      if (!it || typeof it.sku !== 'string' || !it.sku || it.sku.length > 128) return 'bad_item_sku';
      if (!(typeof it.quantity === 'number' && Number.isFinite(it.quantity) && it.quantity > 0)) return 'bad_item_quantity';
      if (!Number.isInteger(it.total_cents) || Math.abs(it.total_cents) > MAX_CENTS) return 'bad_item_total';
    }
  } else {
    if (typeof d.refund_id !== 'string' || !ID_RE.test(d.refund_id)) return 'bad_refund_id';
    if (typeof d.original_sale_id !== 'string' || !ID_RE.test(d.original_sale_id)) return 'bad_original_sale_id';
    if (!isCents(d.refunded_cents) || d.refunded_cents === 0) return 'bad_refunded_cents';
    if (d.currency !== undefined && d.currency !== 'EUR') return 'unsupported_currency';
    if (d.redemption_id !== undefined && d.redemption_id !== null && typeof d.redemption_id !== 'string') return 'bad_redemption_id';
  }
  return null;
}

const saleKey = (retailer, saleId) => `${retailer}:${saleId}`;

/** sale.completed: покупката се записва при клиента и носи точки по правилата. */
function applySale(db, ev, cfg) {
  const d = ev.data;
  if (!d.customer_ref) return { outcome: 'no_customer_ref', points: 0 };
  const member = findMember(db, d.customer_ref);
  if (!member) return { outcome: 'unknown_customer', points: 0 };
  if (member.card?.status === 'replaced') return { outcome: 'card_replaced', points: 0, customerId: member.customer.id };
  const store = db.prepare("SELECT name FROM stores WHERE pos_code = ? AND pos_code != ''").get(ev.store_code);
  const result = recordPurchase(db, {
    source: 'vamibex', externalId: saleKey(ev.retailer_code, d.sale_id), customerId: member.customer.id,
    shop: store?.name ?? ev.store_code, totalCents: d.total_cents, purchasedAt: isoOrNull(ev.occurred_at),
    storeCode: ev.store_code, registerCode: ev.register_code, pointsBaseCents: pointsBaseCents(d.total_cents, d.items, cfg.earn),
    // касата праща само кода на артикула; името му още не идва
    items: d.items.map((it) => ({ name: it.sku, sku: it.sku, quantity: it.quantity, totalCents: it.total_cents })),
  }, { pointsPerEuro: cfg.pointsPerEuro, scratch: cfg.scratch ?? null, welcomePoints: cfg.welcomePoints ?? 0 });
  if (result.duplicate) return { outcome: 'sale_already_recorded', points: 0, customerId: member.customer.id, purchaseId: result.purchase.id };
  const purchase = result.purchase;
  // награда, чието плащане е започнало за същата кошница, приключва с това събитие
  const begun = db.prepare("SELECT id FROM pos_redemptions WHERE sale_id = ? AND customer_id = ? AND status = 'begun'").all(d.sale_id, member.customer.id);
  for (const r of begun) finishRedemption(db, r.id, 'committed', { eventId: ev.id });
  // връщане, дошло преди самата продажба (от друга каса), се прилага сега
  const waiting = db.prepare(`SELECT id, payload FROM pos_events WHERE retailer_code = ? AND type = 'sale.refunded' AND status = 'applied'
    AND outcome = 'unknown_sale' AND json_extract(payload, '$.data.original_sale_id') = ?`).all(ev.retailer_code, d.sale_id);
  for (const w of waiting) {
    const late = applyRefund(db, JSON.parse(w.payload), cfg);
    db.prepare('UPDATE pos_events SET outcome = ?, points = ?, customer_id = ?, purchase_id = ? WHERE id = ?').run(late.outcome, late.points, late.customerId ?? null, late.purchaseId ?? null, w.id);
  }
  return { outcome: purchase.points_earned > 0 ? 'points' : 'zero_points', points: purchase.points_earned, customerId: member.customer.id, purchaseId: purchase.id };
}

/**
 * sale.refunded (ПРЕДЛОЖЕН формат, още не е договорен с касата): връщане на стока по вече записана покупка.
 * Взима обратно точките за върнатата част; при пълно връщане връща и осребрената награда, ако е посочена.
 * Салдото може да стане отрицателно, ако точките вече са изхарчени: следващите покупки го покриват.
 */
function applyRefund(db, ev, cfg) {
  const d = ev.data;
  const done = db.prepare('SELECT * FROM purchase_refunds WHERE retailer_code = ? AND refund_id = ?').get(ev.retailer_code, d.refund_id);
  if (done) return { outcome: 'refund_already_applied', points: 0, purchaseId: done.purchase_id };
  const purchase = db.prepare("SELECT * FROM purchases WHERE source = 'vamibex' AND external_id = ?").get(saleKey(ev.retailer_code, d.original_sale_id));
  if (!purchase) return { outcome: 'unknown_sale', points: 0 };
  const refunded = Math.min(purchase.total_cents, purchase.refunded_cents + d.refunded_cents);
  const full = d.full === true || refunded >= purchase.total_cents;
  const takenBefore = -db.prepare('SELECT COALESCE(SUM(points_delta), 0) n FROM purchase_refunds WHERE purchase_id = ?').get(purchase.id).n;
  const shouldBeTaken = full ? purchase.points_earned : purchase.total_cents > 0 ? Math.floor((purchase.points_earned * refunded) / purchase.total_cents) : 0;
  const take = Math.max(0, shouldBeTaken - takenBefore);
  const at = nowIso();
  const refundRow = db.prepare(`INSERT INTO purchase_refunds (retailer_code, refund_id, purchase_id, refunded_cents, points_delta, full_refund, confirmed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ev.retailer_code, d.refund_id, purchase.id, refunded - purchase.refunded_cents, -take, full ? 1 : 0, isoOrNull(d.confirmed_at) ?? isoOrNull(ev.occurred_at), at).lastInsertRowid;
  db.prepare('UPDATE purchases SET refunded_cents = ? WHERE id = ?').run(refunded, purchase.id);
  if (take) db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, ?, 'refund', ?, ?)").run(purchase.customer_id, -take, `refund-${refundRow}`, at);
  if (full && d.redemption_id) {
    const r = db.prepare("SELECT * FROM pos_redemptions WHERE id = ? AND customer_id = ? AND status = 'committed'").get(d.redemption_id, purchase.customer_id);
    if (r) finishRedemption(db, r.id, 'reversed', { reason: `refund:${d.refund_id}` });
  }
  return { outcome: 'refund', points: -take, customerId: purchase.customer_id, purchaseId: purchase.id };
}

/**
 * Приема едно събитие от локалния конектор на каса. Записът на събитието, покупката и точките е едно цяло.
 * Връща { event_id, status, outcome, points }:
 *   applied      обработено сега (и когато не носи точки: outcome казва защо);
 *   duplicate    вече е било обработено; ефектът остава първоначалният;
 *   quarantined  непозната версия или невалидни данни: пази се за преглед и може да се прати пак след поправка.
 */
export function acceptEvent(db, { sourceId, event }, cfg) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.id !== 'string' || !ID_RE.test(event.id)) {
    throw new AppError('bad_event', 'Полето event трябва да е обект със свой номер (id).');
  }
  return db.transaction(() => {
    // търговецът влиза в ключа; ако липсва или е сгрешен, събитието пак се пази, под „-“
    const retailer = CODE_RE.test(event.retailer_code ?? '') ? event.retailer_code : '-';
    const existing = db.prepare('SELECT * FROM pos_events WHERE retailer_code = ? AND event_id = ?').get(retailer, event.id);
    if (existing?.status === 'applied') return { event_id: event.id, status: 'duplicate', outcome: existing.outcome, points: existing.points };

    const problem = problemWith(event, cfg);
    const r = problem ? { outcome: problem, points: 0 } : event.type === 'sale.completed' ? applySale(db, event, cfg) : applyRefund(db, event, cfg);
    const row = {
      retailer_code: retailer, event_id: event.id, source_id: sourceId, type: typeof event.type === 'string' ? event.type.slice(0, 64) : '',
      schema_version: Number.isInteger(event.schema_version) ? event.schema_version : null, sequence: Number.isInteger(event.sequence) ? event.sequence : null,
      store_code: CODE_RE.test(event.store_code ?? '') ? event.store_code : '', register_code: CODE_RE.test(event.register_code ?? '') ? event.register_code : '',
      occurred_at: isoOrNull(event.occurred_at), payload: JSON.stringify(event), status: problem ? 'quarantined' : 'applied', outcome: r.outcome,
      customer_id: r.customerId ?? null, purchase_id: r.purchaseId ?? null, points: r.points, received_at: nowIso(),
    };
    if (existing) {
      db.prepare(`UPDATE pos_events SET source_id=@source_id, type=@type, schema_version=@schema_version, sequence=@sequence, store_code=@store_code, register_code=@register_code,
        occurred_at=@occurred_at, payload=@payload, status=@status, outcome=@outcome, customer_id=@customer_id, purchase_id=@purchase_id, points=@points, received_at=@received_at
        WHERE retailer_code=@retailer_code AND event_id=@event_id`).run(row);
    } else {
      db.prepare(`INSERT INTO pos_events (retailer_code, event_id, source_id, type, schema_version, sequence, store_code, register_code, occurred_at, payload, status, outcome, customer_id, purchase_id, points, received_at)
        VALUES (@retailer_code, @event_id, @source_id, @type, @schema_version, @sequence, @store_code, @register_code, @occurred_at, @payload, @status, @outcome, @customer_id, @purchase_id, @points, @received_at)`).run(row);
    }
    return { event_id: event.id, status: row.status, outcome: r.outcome, points: r.points };
  })();
}

export const listEvents = (db, { status = null, limit = 100 } = {}) => db.prepare(`SELECT id, retailer_code, event_id, source_id, type, schema_version, sequence, store_code, register_code,
  occurred_at, status, outcome, customer_id, purchase_id, points, received_at FROM pos_events WHERE (@status IS NULL OR status = @status) ORDER BY id DESC LIMIT @limit`).all({ status, limit });

// ---- членство ----

const checkRetailer = (code, cfg) => {
  if (code !== cfg.retailerCode) throw new AppError('unknown_retailer', 'Непознат търговец.', 404);
};

/** Клиентът зад код, който касата е получила. Ако картата е сменена, няма право на точки и награди. */
function activeMember(db, code) {
  const member = findMember(db, code);
  if (!member) throw new AppError('member_not_found', 'Няма клиент с такъв код.', 404);
  if (member.card?.status === 'replaced') throw new AppError('card_replaced', 'Тази карта е сменена с нова и вече не важи.', 409);
  return member.customer;
}

/** Сканирана или въведена карта → постоянният код на клиента и точките му */
export function resolveMember(db, body, cfg) {
  checkRetailer(body?.retailer_code, cfg);
  const member = findMember(db, body?.card_code);
  if (!member) throw new AppError('member_not_found', 'Няма клиент с такъв код.', 404);
  if (member.card?.status === 'replaced') return { customer_ref: null, membership_status: 'card_replaced', balance_points: 0 };
  return { customer_ref: member.customer.customer_ref, membership_status: 'active', balance_points: balance(db, member.customer.id) };
}

// ---- награди на касата ----

const redemptionView = (db, r) => ({
  redemption_id: r.id, status: r.status, reserved_points: r.points, discount_cents: r.discount_cents,
  expires_at: r.status === 'reserved' ? r.expires_at : null,
  customer_ref: getCustomer(db, r.customer_id)?.customer_ref ?? null, reward_id: r.reward_id, reward_title: r.reward_title,
  sale_id: r.sale_id, sale_revision: r.sale_revision, store_code: r.store_code, register_code: r.register_code,
  event_id: r.event_id, created_at: r.created_at, begun_at: r.begun_at, resolved_at: r.resolved_at,
});
const getRow = (db, id) => {
  const r = db.prepare('SELECT * FROM pos_redemptions WHERE id = ?').get(String(id ?? ''));
  if (!r) throw new AppError('no_redemption', 'Няма такава резервация.', 404);
  return r;
};

/** Приключва резервация: committed не пипа точките, released / expired / reversed ги връщат с нов запис в книгата. */
function finishRedemption(db, id, status, { eventId = null, saleId = null, reason = null } = {}) {
  const r = getRow(db, id), at = nowIso();
  db.prepare('UPDATE pos_redemptions SET status = ?, resolved_at = ?, event_id = COALESCE(?, event_id), sale_id = COALESCE(?, sale_id), release_reason = COALESCE(?, release_reason) WHERE id = ?')
    .run(status, at, eventId, saleId, reason, id);
  if (status !== 'committed') {
    db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, ?, 'reward_refund', ?, ?)").run(r.customer_id, r.points, `pos-${id}`, at);
  }
}

/** Резервациите, чийто срок е минал, преди плащането да е започнало, се освобождават. Започнатите не изтичат сами. */
export function expireReservations(db, now = nowIso()) {
  const stale = db.prepare("SELECT id FROM pos_redemptions WHERE status = 'reserved' AND expires_at <= ?").all(now);
  if (!stale.length) return 0;
  db.transaction(() => { for (const r of stale) finishRedemption(db, r.id, 'expired'); })();
  return stale.length;
}

/** Кои награди може да вземе клиентът за тази кошница: стигат му точките и отстъпката не надхвърля сумата. */
export function quoteRewards(db, body, cfg) {
  checkRetailer(body?.retailer_code, cfg);
  if (body.currency !== undefined && body.currency !== 'EUR') throw new AppError('unsupported_currency', 'Поддържа се само евро.');
  if (!isCents(body.total_cents)) throw new AppError('bad_total', 'Сумата на кошницата не е вярна.');
  expireReservations(db);
  const customer = activeMember(db, body.customer_ref);
  const points = balance(db, customer.id);
  const rewards = db.prepare('SELECT id, title, description, cost_points, discount_cents FROM rewards WHERE active = 1 AND discount_cents > 0 ORDER BY cost_points, id').all()
    .filter((r) => r.cost_points <= points && r.discount_cents <= body.total_cents)
    .map((r) => ({ reward_id: r.id, title: r.title, description: r.description, points: r.cost_points, discount_cents: r.discount_cents }));
  return { customer_ref: customer.customer_ref, balance_points: points, currency: 'EUR', rewards, valid_until: inMinutes(cfg.quoteMinutes ?? 5) };
}

/**
 * Резервира награда за кошница. Точките излизат от салдото веднага, затова същите точки не могат да се
 * изхарчат едновременно в друг магазин. За една кошница може да има само една действаща резервация.
 */
export function reserveRedemption(db, sourceId, body, cfg) {
  checkRetailer(body?.retailer_code, cfg);
  if (typeof body.sale_id !== 'string' || !ID_RE.test(body.sale_id)) throw new AppError('bad_sale_id', 'Липсва номерът на кошницата (sale_id).');
  if (body.revision !== undefined && body.revision !== null && !Number.isInteger(body.revision)) throw new AppError('bad_revision', 'Ревизията на кошницата не е вярна.');
  if (body.total_cents !== undefined && !isCents(body.total_cents)) throw new AppError('bad_total', 'Сумата на кошницата не е вярна.');
  for (const k of ['store_code', 'register_code']) if (body[k] !== undefined && !CODE_RE.test(String(body[k]))) throw new AppError('bad_store_or_register', 'Кодът на магазина или касата не е верен.');
  return db.transaction(() => {
    expireReservations(db);
    const customer = activeMember(db, body.customer_ref);
    const reward = db.prepare('SELECT * FROM rewards WHERE id = ? AND active = 1 AND discount_cents > 0').get(Number(body.reward_id) || 0);
    if (!reward) throw new AppError('no_reward', 'Тази награда не се предлага на касата.', 404);
    if (db.prepare("SELECT 1 FROM pos_redemptions WHERE sale_id = ? AND status IN ('reserved','begun')").get(body.sale_id)) {
      throw new AppError('sale_has_redemption', 'За тази кошница вече има резервирана награда.', 409);
    }
    if (body.total_cents !== undefined && reward.discount_cents > body.total_cents) throw new AppError('discount_exceeds_total', 'Отстъпката е по-голяма от сумата на кошницата.', 409);
    const have = balance(db, customer.id);
    if (have < reward.cost_points) throw new AppError('not_enough_points', `Не достигат ${reward.cost_points - have} точки.`, 409);
    const id = 'rd_' + crypto.randomBytes(12).toString('hex'), at = nowIso();
    db.prepare(`INSERT INTO pos_redemptions (id, retailer_code, customer_id, reward_id, reward_title, points, discount_cents, status, source_id, store_code, register_code, sale_id, sale_revision, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?)`).run(id, cfg.retailerCode, customer.id, reward.id, reward.title, reward.cost_points, reward.discount_cents,
      sourceId, body.store_code ?? '', body.register_code ?? '', body.sale_id, body.revision ?? null, at, inMinutes(cfg.holdMinutes ?? 15));
    db.prepare("INSERT INTO points_ledger (customer_id, delta, reason, ref, created_at) VALUES (?, ?, 'reward', ?, ?)").run(customer.id, -reward.cost_points, `pos-${id}`, at);
    return redemptionView(db, getRow(db, id));
  })();
}

const wrongState = (r, wanted) => new AppError('wrong_state', `Резервацията е в състояние „${r.status}“, а за това действие трябва да е ${wanted}.`, 409);

/** Плащането започва: оттук нататък резервацията не изтича сама, а чака окончателен резултат. */
export function beginRedemption(db, id, body = {}) {
  return db.transaction(() => {
    expireReservations(db);
    const r = getRow(db, id);
    if (body.sale_id !== undefined && body.sale_id !== r.sale_id) throw new AppError('sale_mismatch', 'Резервацията е за друга кошница.', 409);
    if (r.status === 'begun') return redemptionView(db, r);
    if (r.status !== 'reserved') throw wrongState(r, 'reserved');
    db.prepare("UPDATE pos_redemptions SET status = 'begun', begun_at = ?, sale_revision = COALESCE(?, sale_revision) WHERE id = ?").run(nowIso(), Number.isInteger(body.revision) ? body.revision : null, id);
    return redemptionView(db, getRow(db, id));
  })();
}

/** Продажбата е приключила: наградата е окончателно осребрена и се връзва с продажбата и събитието ѝ. */
export function commitRedemption(db, id, body = {}) {
  return db.transaction(() => {
    const r = getRow(db, id);
    if (typeof body.sale_id !== 'string' || !ID_RE.test(body.sale_id)) throw new AppError('bad_sale_id', 'Липсва номерът на приключената продажба (sale_id).');
    if (body.sale_id !== r.sale_id) throw new AppError('sale_mismatch', 'Резервацията е за друга кошница.', 409);
    if (body.event_id !== undefined && body.event_id !== null && (typeof body.event_id !== 'string' || !ID_RE.test(body.event_id))) throw new AppError('bad_event_id', 'Номерът на събитието не е верен.');
    if (r.status === 'committed') {
      if (body.event_id && r.event_id && body.event_id !== r.event_id) throw new AppError('event_mismatch', 'Резервацията вече е приключена с друго събитие.', 409);
      if (body.event_id && !r.event_id) db.prepare('UPDATE pos_redemptions SET event_id = ? WHERE id = ?').run(body.event_id, id);
      return redemptionView(db, getRow(db, id));
    }
    // потвърждава се само след започнато плащане: така се знае, че отстъпката наистина е влязла в сметката
    if (r.status !== 'begun') throw wrongState(r, 'begun');
    finishRedemption(db, id, 'committed', { eventId: body.event_id ?? null });
    return redemptionView(db, getRow(db, id));
  })();
}

/** Наградата няма да се ползва: точките се връщат. След приключена продажба вече не може. */
export function releaseRedemption(db, id, body = {}) {
  return db.transaction(() => {
    expireReservations(db);
    const r = getRow(db, id);
    if (r.status === 'released' || r.status === 'expired') return redemptionView(db, r);
    if (r.status !== 'reserved' && r.status !== 'begun') throw wrongState(r, 'reserved или begun');
    finishRedemption(db, id, 'released', { reason: String(body.reason ?? '').slice(0, 200) || null });
    return redemptionView(db, getRow(db, id));
  })();
}

/** Действителното състояние, за сверяване след прекъсване */
export function getRedemption(db, id) {
  expireReservations(db);
  return redemptionView(db, getRow(db, id));
}

// ---- Idempotency-Key ----

/**
 * Изпълнява fn веднъж за даден ключ. Повторение със същия ключ и същите данни връща същия отговор (и при отказ);
 * със същия ключ, но други данни, е грешка. Без ключ fn просто се изпълнява.
 * Връща { status, body }.
 */
export function idempotent(db, { sourceId, key, route, body }, fn) {
  const run = () => {
    try {
      return { status: 200, body: fn() };
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      return { status: err.status, body: { error: err.code, message: err.message } };
    }
  };
  if (key === undefined || key === null || key === '') return run();
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key)) return { status: 400, body: { error: 'bad_idempotency_key', message: 'Idempotency-Key трябва да е от 1 до 128 видими знака без интервали.' } };
  const hash = sha(JSON.stringify(body ?? null));
  return db.transaction(() => {
    const saved = db.prepare('SELECT * FROM idempotency_keys WHERE source_id = ? AND key = ?').get(sourceId, key);
    if (saved) {
      if (saved.route !== route || saved.body_hash !== hash) return { status: 422, body: { error: 'idempotency_mismatch', message: 'Този Idempotency-Key вече е използван с други данни.' } };
      return { status: saved.status, body: JSON.parse(saved.response) };
    }
    const result = run();
    db.prepare('INSERT INTO idempotency_keys (source_id, key, route, body_hash, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sourceId, key, route, hash, result.status, JSON.stringify(result.body), nowIso());
    return result;
  })();
}
