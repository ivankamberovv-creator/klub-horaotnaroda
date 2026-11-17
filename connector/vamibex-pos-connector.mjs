#!/usr/bin/env node
// Локален конектор между една каса с Vamibex POS и централната програма за лоялност (клуб „Хора от Народа“).
//
// Работи на самата каса: чете приключените продажби от локалния API на касата (127.0.0.1:8766)
// и ги праща една по една към сървъра на клуба през HTTPS. Помни докъде е стигнал във файл,
// затова след спиране, рестарт или прекъснат интернет продължава оттам, без да губи и без да повтаря.
// Един файл, без външни пакети; иска Node 18 или по-нов. Настройките и пускането са в docs/vamibex-pos.md.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Грешка при връзката: where е „pos“ (касата) или „loyalty“ (сървърът на клуба) */
export class ConnectorError extends Error {
  constructor(where, message, status = null) { super(message); this.where = where; this.status = status; }
}

/** Напредъкът във файл. Записва се в нов файл и после се преименува, за да не остане наполовина при спрян ток. */
export function fileState(path) {
  return {
    load() {
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return {};
        throw new Error(`Файлът с напредъка (${path}) не се чете: ${err.message}. Не започвам отначало сам, за да не се изгуби докъде е стигнато.`);
      }
    },
    save(state) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path + '.tmp', JSON.stringify({ ...state, updated_at: new Date().toISOString() }));
      renameSync(path + '.tmp', path);
    },
  };
}

/** Колко да се изчака след поредна грешка: 1, 2, 4… секунди, най-много минута, с малко случайност, за да не тръгват всички каси заедно */
export function backoffMs(attempt, random = Math.random) {
  const base = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 10));
  return Math.round(base * (0.75 + random() * 0.5));
}

/**
 * posUrl, posToken: локалният API на касата и ключът му (VAMIBEX_LOYALTY_TOKEN);
 * loyaltyUrl, sourceId, sourceToken: сървърът на клуба и самоличността на тази инсталация;
 * state: { load(), save(state) }; limit: 1–100 събития на страница.
 */
export function createConnector({ posUrl, posToken, loyaltyUrl, sourceId, sourceToken, state, limit = 50, fetchImpl = fetch, timeoutMs = 15_000, log = console }) {
  const request = async (where, url, options) => {
    try {
      return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new ConnectorError(where, `${where === 'pos' ? 'Касата' : 'Сървърът на клуба'} не отговаря: ${err.message}`);
    }
  };

  /** Една страница: чете от касата, праща към клуба, записва напредъка. Връща { forwarded, hasMore, cursor }. */
  async function step() {
    const saved = state.load();
    let cursor = Number.isInteger(saved.cursor) ? saved.cursor : 0;

    const res = await request('pos', `${posUrl}/api/integrations/v1/events?after=${cursor}&limit=${limit}`, { headers: { authorization: `Bearer ${posToken}` } });
    if (res.status !== 200) throw new ConnectorError('pos', `Касата отговори с ${res.status}${res.status === 401 ? ': ключът VAMIBEX_LOYALTY_TOKEN не е верен' : ''}.`, res.status);
    let page;
    try { page = await res.json(); } catch { throw new ConnectorError('pos', 'Касата върна отговор, който не е JSON.'); }
    if (!page || typeof page.environment !== 'string' || !Array.isArray(page.events) || !Number.isInteger(page.next_cursor) || typeof page.has_more !== 'boolean') {
      throw new ConnectorError('pos', 'Отговорът на касата не е във вида, който очаквам (environment, events, next_cursor, has_more).');
    }
    // журналът на касата върви само напред; по-малък курсор значи друга каса или изтрит журнал
    if (page.next_cursor < cursor) throw new ConnectorError('pos', `Касата върна курсор ${page.next_cursor}, по-малък от записания ${cursor}. Спирам, за да не се повторят продажби.`);
    if (saved.environment && saved.environment !== page.environment) {
      throw new ConnectorError('pos', `Средата на касата се е сменила от „${saved.environment}“ на „${page.environment}“. За новата среда е нужен нов файл с напредъка.`);
    }

    let forwarded = 0;
    for (const event of page.events) {
      const sent = await request('loyalty', `${loyaltyUrl}/api/loyalty/v1/events`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${sourceToken}` },
        body: JSON.stringify({ source_id: sourceId, environment: page.environment, event }),
      });
      // 200: приложено или вече е било приложено; 202: прибрано за преглед. И в двата случая събитието е на сигурно място.
      if (sent.status !== 200 && sent.status !== 202) {
        throw new ConnectorError('loyalty', `Сървърът на клуба отговори с ${sent.status} за събитие ${event?.id ?? '?'}${sent.status === 401 ? ': ключът на инсталацията (SOURCE_TOKEN) не е верен' : ''}.`, sent.status);
      }
      forwarded++;
      if (sent.status === 202) log.warn?.(`Събитие ${event?.id ?? '?'} е прибрано за преглед на сървъра (не е приложено).`);
      // напредъкът се записва след всяко прието събитие: при прекъсване по средата не се праща наново цялата страница
      if (Number.isInteger(event?.sequence) && event.sequence > cursor) {
        cursor = event.sequence;
        state.save({ cursor, environment: page.environment });
      }
    }
    if (page.next_cursor > cursor || !saved.environment) {
      cursor = Math.max(cursor, page.next_cursor);
      state.save({ cursor, environment: page.environment });
    }
    return { forwarded, hasMore: page.has_more, cursor };
  }

  /** Върти се, докато не бъде спрян. При още страници чете веднага; при грешка изчаква все по-дълго и пази курсора. */
  async function run({ pollMs = 3000, signal, sleep } = {}) {
    // чакането се прекъсва веднага, щом конекторът бъде спрян
    sleep ??= (ms) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    let failures = 0;
    while (!signal?.aborted) {
      try {
        const r = await step();
        if (failures) log.log?.('Връзката се възстанови.');
        failures = 0;
        if (r.forwarded) log.log?.(`Изпратени ${r.forwarded} продажби; курсор ${r.cursor}.`);
        if (!r.hasMore) await sleep(pollMs);
      } catch (err) {
        const wait = backoffMs(failures++);
        log.error?.(`${err.message} Нов опит след ${Math.round(wait / 1000)} сек.`);
        await sleep(wait);
      }
    }
  }

  return { step, run };
}

// ---- пускане от командния ред ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const cfg = {
    posUrl: (env.POS_URL || 'http://127.0.0.1:8766').replace(/\/+$/, ''),
    posToken: env.VAMIBEX_LOYALTY_TOKEN || '',
    loyaltyUrl: (env.LOYALTY_URL || '').replace(/\/+$/, ''),
    sourceId: env.SOURCE_ID || '',
    sourceToken: env.SOURCE_TOKEN || '',
    stateFile: env.STATE_FILE || './vamibex-pos-connector.state.json',
    pollSeconds: Number(env.POLL_SECONDS || 3),
    limit: Number(env.PAGE_LIMIT || 50),
  };
  const problems = [];
  if (!/^[A-Za-z0-9._~-]{32,256}$/.test(cfg.posToken)) problems.push('VAMIBEX_LOYALTY_TOKEN липсва или не е във вида на касата (32–256 знака: букви, цифри, точка, долна черта, тилда, тире)');
  if (!/^https?:\/\/.+/.test(cfg.loyaltyUrl)) problems.push('LOYALTY_URL липсва (адресът на сървъра на клуба, например https://klub.primer.bg)');
  else if (cfg.loyaltyUrl.startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(cfg.loyaltyUrl) && env.ALLOW_HTTP !== '1') problems.push('LOYALTY_URL трябва да е с https (без шифроване е позволено само към тази машина)');
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(cfg.sourceId)) problems.push('SOURCE_ID липсва (постоянното име на тази инсталация, както е записано в управлението на клуба)');
  if (!cfg.sourceToken) problems.push('SOURCE_TOKEN липсва (ключът на тази инсталация от управлението на клуба)');
  if (!(cfg.pollSeconds >= 1 && cfg.pollSeconds <= 300)) problems.push('POLL_SECONDS трябва да е от 1 до 300 (препоръчително 2–5)');
  if (!(Number.isInteger(cfg.limit) && cfg.limit >= 1 && cfg.limit <= 100)) problems.push('PAGE_LIMIT трябва да е от 1 до 100');
  if (problems.length) {
    console.error('Конекторът не тръгва:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
  const stop = new AbortController();
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => stop.abort());
  console.log(`Конектор „${cfg.sourceId}“: от ${cfg.posUrl} към ${cfg.loyaltyUrl}; напредъкът е в ${cfg.stateFile}.`);
  await createConnector({ ...cfg, state: fileState(cfg.stateFile) }).run({ pollMs: cfg.pollSeconds * 1000, signal: stop.signal });
}
