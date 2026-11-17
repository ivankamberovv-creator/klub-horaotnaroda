// Общото за проверките на връзката с касата Vamibex POS: сървър с един клиент и две каси, и примерно събитие.
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { createDemoKasa } from '../src/connectors/demo.js';
import * as core from '../src/core.js';
import * as loyalty from '../src/loyalty.js';

export const base = { demo: true, adminPassword: 'admin-parola-123', kasaPin: '654321', pointsPerEuro: 1, cardPrefix: '29', environment: 'production', retailerCode: 'HORA' };

/** Сървър с празна база, един клиент и две инсталации на каси в различни магазини */
export async function setup(cfg = {}) {
  const config = { ...base, ...cfg };
  const db = openDb(':memory:');
  const app = await buildApp({ db, config, mail: { send: async () => {} }, kasa: createDemoKasa() });
  const call = async (method, url, body, token, headers = {}) => {
    const res = await app.inject({ method, url, payload: body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  const login = async (email = 'maria@primer.bg') => {
    const r = await call('POST', '/api/auth/request-code', { email });
    return (await call('POST', '/api/auth/verify', { email, code: r.body.demoCode })).body;
  };
  const east = loyalty.createSource(db, 'east-pos-1'), west = loyalty.createSource(db, 'west-pos-1');
  const me = await login();
  /** Праща събитие така, както го праща конекторът */
  const send = (event, source = east, environment = 'production') => call('POST', '/api/loyalty/v1/events', { source_id: source.source_id, environment, event }, source.token);
  return { db, app, call, login, east, west, me, send, ref: me.me.customerRef, card: me.me.cardCode, points: () => core.balance(db, me.me.id) };
}

let n = 0;
/** Събитие sale.completed, както го дава касата (примерът от описанието ѝ), с възможност за промени */
export function sale(customerRef, over = {}, data = {}) {
  n++;
  const saleId = data.sale_id ?? String(n).padStart(32, '0');
  return {
    id: `sale.completed:${saleId}`, sequence: n, type: 'sale.completed', schema_version: 1,
    retailer_code: 'HORA', store_code: 'EAST', register_code: 'POS-1', occurred_at: '2026-11-17T10:00:00.000+00:00',
    ...over,
    data: { sale_id: saleId, currency: 'EUR', total_cents: 1020, customer_ref: customerRef,
      items: [{ sku: 'P-01', quantity: 2, total_cents: 240 }, { sku: 'P-02', quantity: 1, total_cents: 780 }], ...data },
  };
}
