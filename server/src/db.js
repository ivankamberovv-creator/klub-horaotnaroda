// Базата данни: един SQLite файл. Парите са в евроцентове (цели числа), времената са ISO низове в UTC.
// Ползва се вграденият в Node SQLite (node:sqlite), за да няма нищо за компилиране при инсталиране:
// на Windows външните пакети за SQLite искат Visual Studio.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Клиентът влиза с имейл (малки букви) и еднократен код, пратен на него.
const customersTable = (name) => `CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  card_code TEXT NOT NULL UNIQUE,      -- кодът, който касата сканира (EAN-13)
  kasa_id TEXT,                        -- номерът на клиента в касовата програма, когато бъде вързана
  birthday TEXT,                       -- само месец и ден, „ММ-ДД“; годината не се пита
  birthday_set_at TEXT,
  favorite_store_id INTEGER,
  news_seen_at TEXT,                   -- докога клиентът е прочел новините
  created_at TEXT NOT NULL
);`;

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
  reason TEXT NOT NULL CHECK (reason IN ('purchase','reward','reward_refund','bonus','adjustment')),
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
  // в първата версия книгата с точките не допускаше причина „bonus“; правилото се сменя само с нова таблица
  const ledger = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'points_ledger'").get().sql;
  if (!ledger.includes("'bonus'")) {
    db.transaction(() => {
      db.exec(`CREATE TABLE points_ledger_new (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('purchase','reward','reward_refund','bonus','adjustment')),
        ref TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO points_ledger_new SELECT id, customer_id, delta, reason, ref, created_at FROM points_ledger;
      DROP TABLE points_ledger;
      ALTER TABLE points_ledger_new RENAME TO points_ledger;
      CREATE INDEX IF NOT EXISTS points_ledger_customer ON points_ledger(customer_id);`);
    })();
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
