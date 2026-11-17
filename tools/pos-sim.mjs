#!/usr/bin/env node
// Пробна каса: отговаря като локалния API на Vamibex POS за приключените продажби
// (GET /api/integrations/v1/events?after=&limit=), за да може конекторът и сървърът на клуба да се пробват
// без истинска каса. Не е част от касата и не я замества: държи продажбите само в паметта.
//   node tools/pos-sim.mjs <customer_ref> [брой продажби]      (ключът идва от VAMIBEX_LOYALTY_TOKEN, портът от POS_PORT)
// На всеки 5 секунди добавя по една нова продажба за същия клиент.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const token = process.env.VAMIBEX_LOYALTY_TOKEN || '';
const port = Number(process.env.POS_PORT || 8766);
const customerRef = process.argv[2];
if (!/^[A-Za-z0-9._~-]{32,256}$/.test(token) || !customerRef) {
  console.error('Трябват VAMIBEX_LOYALTY_TOKEN (32–256 знака) и кодът на клиента: node tools/pos-sim.mjs L-XXXXXXXX [брой]');
  process.exit(1);
}
const journal = [];
let sequence = 40;
function ring() {
  // продажбите без клиент не стигат до лоялността, затова номерата имат пропуски
  sequence += 1 + Math.floor(Math.random() * 3);
  const saleId = randomBytes(16).toString('hex');
  const items = [{ sku: 'P-01', quantity: 2, total_cents: 240 }, { sku: 'P-02', quantity: 1, total_cents: 780 }];
  journal.push({ id: `sale.completed:${saleId}`, sequence, type: 'sale.completed', schema_version: 1, retailer_code: 'HORA', store_code: 'EAST', register_code: 'POS-1',
    occurred_at: new Date().toISOString(), data: { sale_id: saleId, currency: 'EUR', total_cents: 1020, customer_ref: customerRef, items } });
}
for (let i = 0; i < Number(process.argv[3] || 3); i++) ring();
setInterval(ring, 5000);

createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname !== '/api/integrations/v1/events') return send(404, { error: 'not_found' });
  if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
  if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
  const after = Number(url.searchParams.get('after') ?? 0), limit = Number(url.searchParams.get('limit') ?? 50);
  if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) return send(400, { error: 'bad_request' });
  const rest = journal.filter((e) => e.sequence > after), events = rest.slice(0, limit);
  send(200, { environment: 'simulation', events, next_cursor: events.length ? events.at(-1).sequence : after, has_more: rest.length > limit });
}).listen(port, '127.0.0.1', () => console.log(`Пробна каса на http://127.0.0.1:${port} (среда simulation), клиент ${customerRef}.`));
