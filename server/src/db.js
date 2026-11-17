// Базата данни: един SQLite файл. Парите са в евроцентове (цели числа), времената са ISO низове в UTC.
// Ползва се вграденият в Node SQLite (node:sqlite), за да няма нищо за компилиране при инсталиране:
// на Windows външните пакети за SQLite искат Visual Studio.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Клиентът влиза с имейл (малки букви) и еднократен код, пратен на него.
const customersTable = (name) => `CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  card_code TEXT NOT NULL UNIQUE,      -- кодът, който касата сканира (EAN-13); сегашната карта, всички карти са в cards
  customer_ref TEXT,                   -- постоянният код на клиента пред касата (Vamibex POS): не се сменя при нова карта
  kasa_id TEXT,                        -- номерът на клиента в касовата програма, когато бъде вързана
  birthday TEXT,                       -- само месец и ден, „ММ-ДД“; годината не се пита
  birthday_set_at TEXT,
  favorite_store_id INTEGER,
  news_seen_at TEXT,                   -- докога клиентът е прочел новините
  created_at TEXT NOT NULL
);`;

const LEDGER_REASONS = "'purchase','reward','reward_refund','bonus','adjustment','refund'";

const SCHEMA = `
${customersTable('customers')}
CREATE TABLE IF NOT EXISTS otp_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS otp_requests (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_requests_email ON otp_requests(email, at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('customer','kasa','admin')),
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  tag TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  -- discount: отстъпка в проценти, прилага я касата; double_points: множител на точките;
  -- bonus_points: точки отгоре при покупка над min_total_cents; info: само съобщение
  kind TEXT NOT NULL CHECK (kind IN ('discount','double_points','bonus_points','info')),
  value INTEGER NOT NULL DEFAULT 0,
  min_total_cents INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  image_url TEXT NOT NULL DEFAULT '',
  -- празно: важи винаги; sun, clouds, rain, fog или snow: показва се само при такова време навън
  weather TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activations (
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  activated_at TEXT NOT NULL,
  PRIMARY KEY (customer_id, promotion_id)
);
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cost_points INTEGER NOT NULL CHECK (cost_points > 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reward_id INTEGER REFERENCES rewards(id) ON DELETE SET NULL,
  reward_title TEXT NOT NULL,          -- копие, за да остане вярно и ако наградата се преименува
  points INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','issued','cancelled')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS redemptions_customer ON redemptions(customer_id, status);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,                -- откъде е дошла: demo, yanak
  external_id TEXT NOT NULL,           -- номерът на документа в касовата програма
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  shop TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL,        -- платеното, след отстъпките
  discount_cents INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  purchased_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS purchases_customer ON purchases(customer_id, purchased_at);
CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  total_cents INTEGER NOT NULL
);
-- Точките са книга със записи: салдото е сборът. Нищо не се трие и не се поправя на място.
CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN (${LEDGER_REASONS})),
  ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS points_ledger_customer ON points_ledger(customer_id);
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  -- работното време като JSON: „24/7“ или седем полета от понеделник до неделя: ["8:00","20:00"], null (почивен ден) или "?" (не е посочено)
  hours TEXT NOT NULL DEFAULT '[]',
  lat REAL,
  lng REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
-- Талон за изтриване: идва след покупка; наградата е решена още при създаването, но клиентът я вижда чак като го изтрие.
CREATE TABLE IF NOT EXISTS scratch_cards (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  purchase_id INTEGER NOT NULL UNIQUE REFERENCES purchases(id) ON DELETE CASCADE,
  prize_points INTEGER NOT NULL CHECK (prize_points > 0),
  status TEXT NOT NULL CHECK (status IN ('new','revealed')),
  created_at TEXT NOT NULL,
  revealed_at TEXT
);
CREATE INDEX IF NOT EXISTS scratch_cards_customer ON scratch_cards(customer_id, status);
-- Мисия: „направете N покупки“ (purchases) или „пазарувайте общо за X“ (spend, в евроцентове) в даден срок, срещу точки.
CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('purchases','spend')),
  goal INTEGER NOT NULL CHECK (goal > 0),
  reward_points INTEGER NOT NULL CHECK (reward_points > 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS challenge_completions (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (challenge_id, customer_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---- връзка с касовата програма Vamibex POS (вижте docs/vamibex-pos.md) ----

-- Всички карти на клиента. При смяна старата става replaced, а профилът, точките и customer_ref остават.
CREATE TABLE IF NOT EXISTS cards (
  code TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active','replaced')),
  created_at TEXT NOT NULL,
  replaced_at TEXT
);
CREATE INDEX IF NOT EXISTS cards_customer ON cards(customer_id);
-- Инсталациите на каси, които пращат събития: всяка има постоянен source_id и свой ключ (пази се само отпечатъкът му).
CREATE TABLE IF NOT EXISTS pos_sources (
  source_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  last_sequence INTEGER              -- докъде е стигнала касата по своя журнал (за наблюдение)
);
-- Всяко получено събитие от касата, точно веднъж. status: applied (обработено, може и с 0 точки),
-- quarantined (непозната версия или невалидни данни: чака преглед и може да се прати пак).
CREATE TABLE IF NOT EXISTS pos_events (
  id INTEGER PRIMARY KEY,
  retailer_code TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '',
  schema_version INTEGER,
  sequence INTEGER,
  store_code TEXT NOT NULL DEFAULT '',
  register_code TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  payload TEXT NOT NULL,              -- събитието, както е дошло (JSON)
  status TEXT NOT NULL CHECK (status IN ('applied','quarantined')),
  outcome TEXT NOT NULL DEFAULT '',   -- points, zero_points, unknown_customer, refund… или причината за карантината
  customer_id INTEGER,
  purchase_id INTEGER,
  points INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  UNIQUE (retailer_code, event_id)
);
CREATE INDEX IF NOT EXISTS pos_events_status ON pos_events(status, id);
-- Награда, осребрена на касата: reserved → begun → committed, или released / expired.
-- Точките се взимат от книгата още при резервацията и се връщат при освобождаване.
CREATE TABLE IF NOT EXISTS pos_redemptions (
  id TEXT PRIMARY KEY,                -- rd_…
  retailer_code TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reward_id INTEGER,
  reward_title TEXT NOT NULL,
  points INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','begun','committed','released','expired','reversed')),
  source_id TEXT NOT NULL,
  store_code TEXT NOT NULL DEFAULT '',
  register_code TEXT NOT NULL DEFAULT '',
  sale_id TEXT NOT NULL,              -- кошницата, за която е резервирана
  sale_revision INTEGER,
  event_id TEXT,                      -- sale.completed, с което е приключила
  release_reason TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,           -- важи само докато е reserved; започнато плащане не изтича само
  begun_at TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS pos_redemptions_customer ON pos_redemptions(customer_id, status);
CREATE INDEX IF NOT EXISTS pos_redemptions_sale ON pos_redemptions(sale_id);
-- Връщания на стока: всяка корекция има свой постоянен номер и действа само веднъж.
CREATE TABLE IF NOT EXISTS purchase_refunds (
  id INTEGER PRIMARY KEY,
  retailer_code TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  refunded_cents INTEGER NOT NULL,
  points_delta INTEGER NOT NULL,      -- колко точки са взети обратно (отрицателно или 0)
  full_refund INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (retailer_code, refund_id)
);
-- Повторена заявка със същия Idempotency-Key връща същия отговор.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  source_id TEXT NOT NULL,
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_id, key)
);
`;

/**
 * Добавя db.transaction(fn): връща функция, която изпълнява fn като едно цяло: или всичко се записва, или нищо.
 * Ако вече тече такова изпълнение, вътрешното просто става част от външното.
 */
function addTransactions(db) {
  let depth = 0;
  db.transaction = (fn) => (...args) => {
    if (depth > 0) return fn(...args);
    db.exec('BEGIN IMMEDIATE');
    depth++;
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      depth--;
    }
  };
}

const has = (db, table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

/**
 * Преди създаването на таблиците: в старите бази кодовете за вход бяха по телефон.
 * Те живеят 10 минути, затова двете таблици просто се правят наново, вече по имейл.
 */
function upgradeBefore(db) {
  if (has(db, 'otp_codes', 'phone')) db.exec('DROP TABLE otp_codes; DROP TABLE IF EXISTS otp_requests;');
}

/**
 * Стара база, в която клиентът беше с телефон: таблицата се прави наново с имейл.
 * Номерата на клиентите, кодовете на картите и точките остават. Понеже имейл няма откъде да дойде,
 * старият запис получава адрес, на който не може да се прати писмо („tel359…@bez-imeil.invalid“):
 * с него не се влиза, но историята му не се губи.
 */
function customersToEmail(db) {
  // външните ключове се спират, за да не се изтрият покупките и точките заедно със старата таблица
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`${customersTable('customers_new')}
        INSERT INTO customers_new (id, email, name, card_code, kasa_id, birthday, birthday_set_at, favorite_store_id, news_seen_at, created_at)
          SELECT id, 'tel' || replace(phone, '+', '') || '@bez-imeil.invalid', name, card_code, kasa_id, birthday, birthday_set_at, favorite_store_id, news_seen_at, created_at FROM customers;
        DROP TABLE customers;
        ALTER TABLE customers_new RENAME TO customers;`);
    })();
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/** Довежда по-стара база до сегашния вид: добавя липсващите колони, без да пипа данните. */
function upgrade(db) {
  const add = (table, column, type) => { if (!has(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); };
  add('customers', 'birthday', 'TEXT');
  add('customers', 'birthday_set_at', 'TEXT');
  add('customers', 'favorite_store_id', 'INTEGER');
  add('customers', 'news_seen_at', 'TEXT');
  add('promotions', 'image_url', "TEXT NOT NULL DEFAULT ''");
  add('promotions', 'weather', "TEXT NOT NULL DEFAULT ''");
  if (!has(db, 'customers', 'email')) customersToEmail(db);
  // книгата с точките допуска само изброени причини; нова причина („bonus“, после „refund“ за върната стока)
  // се добавя само с нова таблица. Записите се пренасят без промяна.
  const ledger = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'points_ledger'").get().sql;
  if (!ledger.includes("'refund'")) {
    db.transaction(() => {
      db.exec(`CREATE TABLE points_ledger_new (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN (${LEDGER_REASONS})),
        ref TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO points_ledger_new SELECT id, customer_id, delta, reason, ref, created_at FROM points_ledger;
      DROP TABLE points_ledger;
      ALTER TABLE points_ledger_new RENAME TO points_ledger;
      CREATE INDEX IF NOT EXISTS points_ledger_customer ON points_ledger(customer_id);`);
    })();
  }
  // ---- за Vamibex POS ----
  add('customers', 'customer_ref', 'TEXT');
  add('purchases', 'store_code', "TEXT NOT NULL DEFAULT ''");
  add('purchases', 'register_code', "TEXT NOT NULL DEFAULT ''");
  add('purchases', 'refunded_cents', 'INTEGER NOT NULL DEFAULT 0');
  add('purchase_items', 'sku', "TEXT NOT NULL DEFAULT ''");
  add('rewards', 'discount_cents', 'INTEGER NOT NULL DEFAULT 0'); // отстъпката, която касата прилага; 0 = наградата се дава на ръка
  add('stores', 'pos_code', "TEXT NOT NULL DEFAULT ''");          // store_code на магазина в касата
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS customers_ref ON customers(customer_ref)');
  // клиентите отпреди връзката получават постоянен код, а сегашната им карта влиза в списъка с карти
  const bezKod = db.prepare('SELECT id FROM customers WHERE customer_ref IS NULL').all();
  if (bezKod.length) {
    db.transaction(() => {
      const set = db.prepare('UPDATE customers SET customer_ref = ? WHERE id = ?');
      for (const c of bezKod) set.run(newCustomerRef(db), c.id);
    })();
  }
  db.exec(`INSERT OR IGNORE INTO cards (code, customer_id, status, created_at) SELECT card_code, id, 'active', created_at FROM customers`);
}

// Постоянният код на клиента пред касата: „L-“ и 8 знака без лесно бърканите 0, O, 1, I.
// Влиза в правилото на касата за customer_ref ([A-Za-z0-9_-], до 64 знака) и винаги е с главни букви.
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newCustomerRef(db) {
  const exists = db.prepare('SELECT 1 FROM customers WHERE customer_ref = ?');
  for (;;) {
    let ref = 'L-';
    for (const b of randomBytes(8)) ref += REF_ALPHABET[b % REF_ALPHABET.length];
    if (!exists.get(ref)) return ref;
  }
}

/** Отваря (и при нужда създава) базата. ':memory:' дава празна база за тестовете. */
export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  addTransactions(db);
  upgradeBefore(db);
  db.exec(SCHEMA);
  upgrade(db);
  return db;
}
