// Времето навън: за лентата на началния екран и за офертите, които се показват само при определено време.
// Данните идват от Норвежкия метеорологичен институт (MET Norway, api.met.no), лиценз CC BY 4.0:
// в приложението трябва да пише откъде са. Питаме само от сървъра, никога от телефона на клиента.

/** Видовете време, по които може да се пусне оферта */
export const WEATHER_KINDS = ['sun', 'clouds', 'rain', 'fog', 'snow'];

/**
 * Кодът на MET Norway (например „partlycloudy_day“, „heavyrainshowersandthunder_night“) → нашите видове.
 * Суграшицата се брои за сняг. Ясна нощ е „moon“: показва се, но оферти по нея няма. Непознат код → null.
 */
export function fromSymbol(code) {
  const m = /^([a-z]+?)(?:_(day|night|polartwilight))?$/.exec(String(code ?? ''));
  if (!m) return null;
  const base = m[1], isDay = m[2] !== 'night';
  let kind = null;
  if (base.includes('snow') || base.includes('sleet')) kind = 'snow';
  else if (base.includes('rain')) kind = 'rain';
  else if (base === 'fog') kind = 'fog';
  else if (base === 'cloudy' || base === 'partlycloudy') kind = 'clouds';
  else if (base === 'clearsky' || base === 'fair') kind = isDay ? 'sun' : 'moon';
  return kind ? { kind, isDay } : null;
}

/** От отговора на MET Norway взима записа за текущия час: вид време и температура */
export function fromForecast(body, nowMs = Date.now()) {
  const series = body?.properties?.timeseries;
  if (!Array.isArray(series) || !series.length) return null;
  // последният запис, който вече е започнал; ако всички са в бъдещето, първият
  let entry = series[0];
  for (const e of series) {
    if (Date.parse(e.time) <= nowMs) entry = e; else break;
  }
  const data = entry?.data ?? {};
  const seen = fromSymbol(data.next_1_hours?.summary?.symbol_code ?? data.next_6_hours?.summary?.symbol_code);
  if (!seen) return null;
  const temp = Number(data.instant?.details?.air_temperature);
  return { ...seen, temp: Number.isFinite(temp) ? Math.round(temp) : null };
}

const MINUTE = 60 * 1000;
// примерни температури, когато времето е зададено на ръка или е демо
const SAMPLE_TEMP = { sun: 22, clouds: 14, rain: 9, fog: 4, snow: -2 };

/**
 * mode: „off“ (няма време), „live“ (истинското, от MET Norway), „demo“ (сменя се през две минути, за показване)
 * или един от видовете („rain“…), когато трябва да е все едно и също.
 * contact: адрес или сайт за връзка; MET Norway го иска в заглавката User-Agent и без него отказва.
 */
export function createWeather({ mode = 'off', contact = '', fetchImpl = fetch, now = Date.now, log = console.error } = {}) {
  if (mode === 'off') return { mode, at: async () => null };
  if (mode === 'demo') {
    return { mode, at: async () => { const kind = WEATHER_KINDS[Math.floor(now() / (2 * MINUTE)) % WEATHER_KINDS.length]; return { kind, isDay: true, temp: SAMPLE_TEMP[kind], sample: true }; } };
  }
  if (WEATHER_KINDS.includes(mode)) return { mode, at: async () => ({ kind: mode, isDay: true, temp: SAMPLE_TEMP[mode], sample: true }) };
  if (mode !== 'live') throw new Error(`Няма време „${mode}“. Има off, live, demo и ${WEATHER_KINDS.join(', ')}.`);
  if (!contact) throw new Error('За истинското време трябва WEATHER_CONTACT: имейл или сайт за връзка, който MET Norway иска при всяко питане.');

  const cache = new Map(); // „43.2,27.9“ → { value, at, until, pending }
  const userAgent = `klub-horaotnaroda/1.0 ${contact}`;

  async function load(lat, lng) {
    const res = await fetchImpl(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lng}`,
      { headers: { 'user-agent': userAgent, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`MET Norway отговори с ${res.status}`);
    const value = fromForecast(await res.json(), now());
    // MET Norway казва докога да не питаме пак (Expires); не по-често от половин час и не по-рядко от три часа
    const expires = Date.parse(res.headers.get('expires') ?? '');
    const wait = Math.min(180 * MINUTE, Math.max(30 * MINUTE, Number.isFinite(expires) ? expires - now() : 0));
    return { value, wait };
  }

  return {
    mode,
    /** Времето около точката; null, ако още не се знае. Първият път чака най-много waitMs, после отговаря веднага от запомненото. */
    async at(lat, lng, waitMs = 1500) {
      // закръгляме до десета от градуса (около 10 км): магазините в един град питат за едно и също
      const key = `${Number(lat).toFixed(1)},${Number(lng).toFixed(1)}`;
      let e = cache.get(key);
      if (!e) cache.set(key, e = { value: null, at: 0, until: 0, pending: null });
      if (now() < e.until) return e.value;
      if (!e.pending) {
        const [la, lo] = key.split(',');
        e.pending = load(la, lo).then(({ value, wait }) => { e.value = value; e.at = now(); e.until = now() + wait; })
          .catch((err) => {
            log(`Времето за ${key} не дойде: ${err.message}`);
            e.until = now() + 10 * MINUTE;             // след грешка питаме пак чак след десет минути
            if (now() - e.at > 6 * 60 * MINUTE) e.value = null; // а старото важи най-много шест часа
          }).finally(() => { e.pending = null; });
      }
      if (e.value) return e.value; // има старо: връщаме него, новото идва за следващия път
      let timer;
      const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
      return Promise.race([e.pending.then(() => e.value), late]).finally(() => clearTimeout(timer));
    },
  };
}
