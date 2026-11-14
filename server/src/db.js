// Базата данни: един SQLite файл. Парите са в евроцентове (цели числа), времената са ISO низове в UTC.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  card_code TEXT NOT NULL UNIQUE,      -- кодът, който касата сканира (EAN-13)
  kasa_id TEXT,                        -- номерът на клиента в касовата програма, когато бъде вързана
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS otp_requests (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  ip TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_requests_phone ON otp_requests(phone, at);
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
  reason TEXT NOT NULL CHECK (reason IN ('purchase','reward','reward_refund','adjustment')),
  ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS points_ledger_customer ON points_ledger(customer_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Отваря (и при нужда създава) базата. ':memory:' дава празна база за тестовете. */
export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
