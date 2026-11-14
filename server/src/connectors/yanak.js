// Връзка с касовата програма „ЯНАК“ (Янак Софт). ЗАГОТОВКА: още не е пробвана срещу истинска инсталация.
//
// Какво е известно от публичната помощ на Янак Софт („API за връзка с програма ЯНАК“, прочетена на 14.11.2026):
//   - REST с JSON; основен адрес https://api.eyanak.com:5555/e-shop/api/
//   - POST /login с email и username връща токен (Bearer), валиден 12 часа
//   - справки за продажбите: POST /api/reports/get-desktop-data (филтри по дата, каса, склад, потребител, клиент),
//     POST /api/reports/get-desktop-doc (един документ); тези пътища са без /e-shop
// Какво НЕ е известно и затова не е написано тук:
//   - как изглежда отговорът на справките (имена на полетата), значи няма как да се превърне в покупки
//   - как касата разпознава клиент по сканиран код и къде се пази този код при клиента
//   - дали бонус точките на ЯНАК се четат отвън
// Когато Янак Софт дадат достъп и примерен отговор, се попълва mapSale() и връзката се включва с KASA=yanak.

export function createYanakKasa({ baseUrl = 'https://api.eyanak.com:5555', email, username } = {}) {
  if (!email || !username) throw new Error('За KASA=yanak трябват YANAK_EMAIL и YANAK_USERNAME.');
  let token = null, tokenUntil = 0;

  async function login() {
    const res = await fetch(`${baseUrl}/e-shop/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, username }),
    });
    if (!res.ok) throw new Error(`ЯНАК: входът не мина (${res.status}).`);
    const data = await res.json();
    token = data.token ?? data.access_token ?? null; // името на полето не е потвърдено
    if (!token) throw new Error('ЯНАК: в отговора на входа няма токен; вижте документацията им.');
    tokenUntil = Date.now() + 11 * 60 * 60 * 1000;
  }

  /** Суровият отговор на справката за продажби; служи за разглеждане, докато се уточнят полетата. */
  async function rawSales(filters) {
    if (!token || Date.now() > tokenUntil) await login();
    const res = await fetch(`${baseUrl}/api/reports/get-desktop-data`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(filters),
    });
    if (!res.ok) throw new Error(`ЯНАК: справката не мина (${res.status}).`);
    return res.json();
  }

  return {
    name: 'yanak',
    canSimulate: false,
    rawSales,
    async fetchSales() {
      throw new Error('ЯНАК: превръщането на продажбите в покупки още не е написано, защото форматът на отговора не е известен.');
    },
  };
}
