// Целият поток: приложението (в браузър с размер на телефон) + страницата за служители, срещу демо сървъра.
// Пуска се върху чиста демо база; вижте README.md, „Проверка от край до край“.
//   node tools/e2e.cjs <папка за снимките> <снимка за качване (jpg)>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const SRV = process.env.KLUB_URL || 'http://localhost:4100', OUT = process.argv[2], PHOTO = process.argv[3];
let ok = 0, fail = 0;
const t = (name, cond, info = '') => { cond ? ok++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  | ' + info : '')); };
(async () => {
  const b = await chromium.launch();
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await phone.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  const id = (x) => `[data-testid="${x}"]`;
  const txt = async (x) => (await p.textContent(id(x))).trim();
  const body = () => p.textContent('body');
  const tab = async (x) => { await p.click(id('tab-' + x)); await p.waitForTimeout(500); };
  const more = async (x) => { await tab('more'); await p.click(id('more-' + x)); await p.waitForTimeout(600); };
  const shot = (name) => p.screenshot({ path: `${OUT}/${name}.png` });
  const noOverflow = async (name) => t(`${name}: няма хоризонтално превъртане`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // ---- вход ----
  await p.goto(SRV); await p.waitForSelector(id('phone'));
  t('страницата е на български и има манифест', await p.evaluate(() => document.documentElement.lang === 'bg' && Boolean(document.querySelector('link[rel="manifest"]'))));
  await shot('01-vhod');
  const number = '0888' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  await p.fill(id('phone'), number); await p.click(id('sendCode')); await p.waitForSelector(id('code'));
  const demo = (await txt('demoCode')).match(/\d{6}/)[0];
  await p.fill(id('code'), demo === '000000' ? '111111' : '000000'); await p.click(id('verify')); await p.waitForTimeout(500);
  t('грешен код: съобщение', (await body()).includes('Кодът не е верен'));
  await p.fill(id('code'), demo); await p.click(id('verify')); await p.waitForSelector(id('name'));
  await p.fill(id('name'), 'Мария Петрова'); await p.click(id('saveName')); await p.waitForSelector(id('points'));
  await p.waitForSelector('[data-testid^="offerTile-"]');
  t('вход: нов клиент с 20 точки за добре дошли', (await txt('points')) === '20', await txt('points'));
  t('началото поздравява по име', (await body()).includes('Здравейте, Мария Петрова'));
  t('началото показва офертите и новините', (await p.$$('[data-testid^="offerTile-"]')).length === 4 && (await body()).includes('Добре дошли в клуба'));
  await noOverflow('начало');
  await shot('02-nachalo');

  // ---- карта ----
  await tab('card');
  const code = (await txt('cardCode')).replace(/\s/g, '');
  t('картата има код от 13 цифри с префикс 29', /^29\d{11}$/.test(code), code);
  await shot('03-karta');
  await noOverflow('карта');

  // ---- оферти ----
  await tab('offers');
  t('оферти: 4 общо, 0 активирани', (await txt('filterAll')) === 'Всички (4)' && (await txt('filterMine')) === 'Активирани (0)');
  const dbl = await p.evaluateHandle(() => [...document.querySelectorAll('[data-testid^="activate-"]')].find((x) => x.parentElement.parentElement.textContent.includes('Двойни точки')));
  await dbl.asElement().click(); await p.waitForTimeout(500);
  t('оферти: след активиране броячът е 1', (await txt('filterMine')) === 'Активирани (1)');
  await p.click(id('filterMine')); await p.waitForTimeout(300);
  t('оферти: филтърът показва само активираната', (await p.$$('[data-testid^="deactivate-"]')).length === 1 && (await p.$$('[data-testid^="activate-"]')).length === 0);
  await p.click(id('filterAll'));
  await shot('04-oferti');
  await noOverflow('оферти');

  // ---- касата ----
  const desk = await b.newContext({ viewport: { width: 1100, height: 800 } });
  const k = await desk.newPage();
  await k.goto(SRV + '/admin/'); await k.fill('#password', 'грешна'); await k.click('#loginForm button'); await k.waitForTimeout(300);
  t('каса: грешна парола се спира', (await k.textContent('#loginErr')).includes('Грешна парола'));
  await k.fill('#password', '1234'); await k.click('#loginForm button'); await k.waitForSelector('#cardCode');
  t('каса: ролята е „Каса“ и управлението е скрито', (await k.textContent('#roleLabel')) === 'Каса' && await k.isHidden('[data-tab="promotions"]') && await k.isHidden('[data-tab="stores"]'));
  await k.fill('#cardCode', code); await k.click('#lookupForm button'); await k.waitForSelector('#customerBox:not([hidden])');
  const box = await k.textContent('#customerBox');
  t('каса: намира клиента и активираната оферта', box.includes('Мария Петрова') && box.includes('Двойни точки'));
  await k.fill('#customerBox input[inputmode="decimal"]', '170,00'); await k.click('#customerBox form button'); await k.waitForTimeout(600);
  t('каса: 170 € с двойни точки = 340 точки', (await k.textContent('#customerBox')).includes('начислени са 340 точки'));
  await k.screenshot({ path: OUT + '/05-kasa.png', fullPage: true });

  // ---- точки, награди, история ----
  await tab('home');
  t('началото показва 360 точки и последната покупка', (await txt('points')) === '360' && (await body()).includes('Последна покупка') && (await body()).includes('170,00 €'));
  await shot('06-nachalo-sled-pokupka');
  await tab('rewards');
  t('награди: показва салдото', (await txt('rewardPoints')).startsWith('360'));
  const five = await p.evaluateHandle(() => [...document.querySelectorAll('[data-testid^="redeem-"]')].find((x) => x.parentElement.textContent.includes('Отстъпка 5 €')));
  await five.asElement().click(); await p.waitForTimeout(300);
  await p.click('[data-testid^="confirm-"]'); await p.waitForTimeout(600);
  t('награди: след размяната остават 110 точки', (await txt('rewardPoints')).startsWith('110') && (await txt('headerPoints')) === '110');
  await shot('07-nagradi');
  await noOverflow('награди');
  await p.click(id('toHistory')); await p.waitForSelector(id('history-0'));
  const rows = await p.$$eval('[data-testid^="history-"]', (els) => els.map((e) => e.textContent));
  t('история: награда, покупка и добре дошли, най-новото отгоре', rows.length === 3 && rows[0].includes('Награда: Отстъпка 5 €') && rows[0].includes('-250')
    && rows[1].includes('Покупка: Пробен магазин') && rows[1].includes('+340') && rows[2].includes('Добре дошли в клуба') && rows[2].includes('+20'), rows.join(' | '));
  await shot('08-istoria');
  await noOverflow('история');

  await k.fill('#cardCode', code); await k.click('#lookupForm button'); await k.waitForTimeout(500);
  t('каса: вижда наградата за издаване', (await k.textContent('#customerBox')).includes('Отстъпка 5 €'));
  await k.click('#customerBox .list button.btn:not(.ghost)'); await k.waitForTimeout(600);
  t('каса: след издаване няма чакащи', (await k.textContent('#customerBox')).includes('Няма заявени награди'));

  // ---- покупки ----
  await more('purchases');
  t('покупки: една покупка за 170,00 € с +340 точки', (await body()).includes('170,00 €') && (await body()).includes('+340 точки'));
  await p.click('[data-testid^="purchase-"]'); await p.waitForTimeout(400);
  await shot('09-pokupki');

  // ---- магазини ----
  await more('stores');
  await p.waitForSelector('[data-testid^="store-"]');
  t('магазини: 18 обекта', (await p.$$('[data-testid^="store-"]')).length === 18);
  await p.fill(id('storeSearch'), 'Варна'); await p.waitForTimeout(300);
  const varna = await p.$$eval('[data-testid^="store-"]', (els) => els.map((e) => e.textContent));
  t('магазини: търсенето по град стеснява списъка', varna.length > 0 && varna.length < 18 && varna.every((x) => x.includes('Варна')), String(varna.length));
  const firstId = await p.$eval('[data-testid^="store-"]:last-child, [data-testid^="store-"]', () => [...document.querySelectorAll('[data-testid^="store-"]')].pop().getAttribute('data-testid').split('-')[1]);
  await p.click(id('favorite-' + firstId)); await p.waitForTimeout(500);
  const top = await p.$eval('[data-testid^="store-"]', (e) => e.getAttribute('data-testid'));
  t('магазини: любимият отива най-отгоре', top === 'store-' + firstId, top);
  t('магазини: има работно време, обаждане и упътване', (await body()).includes('Обадете се') && (await body()).includes('Упътване') && /\d{1,2}:\d{2}–\d{1,2}:\d{2}|Денонощно/.test(await body()));
  await shot('10-magazini');
  await noOverflow('магазини');

  // ---- управление: новина със снимка, оферта със снимка, магазини ----
  await k.click('#logout'); await k.fill('#password', 'demo-admin'); await k.click('#loginForm button'); await k.waitForSelector('#cardCode');
  await k.click('[data-tab="news"]'); await k.waitForTimeout(300);
  await k.fill('#newsTitle', 'Нов магазин в Русе'); await k.fill('#newsBody', 'Отваряме на 1 декември на ул. Александровска.');
  await k.setInputFiles('#newsImage', PHOTO); await k.waitForSelector('#newsImageBox:not([hidden])');
  await k.click('#newsForm button[type=submit]'); await k.waitForTimeout(500);
  t('управление: новината е записана', (await k.textContent('#newsRows')).includes('Нов магазин в Русе'));
  await k.click('[data-tab="promotions"]'); await k.waitForTimeout(300);
  await k.fill('#promoTitle', 'Мед от Странджа'); await k.fill('#promoTag', 'Ноември'); await k.fill('#promoValue', '15');
  await k.setInputFiles('#promoImage', PHOTO); await k.waitForSelector('#promoImageBox:not([hidden])');
  await k.click('#promoForm button[type=submit]'); await k.waitForTimeout(500);
  t('управление: офертата със снимка е записана', (await k.textContent('#promoRows')).includes('Мед от Странджа'));
  await k.setInputFiles('#promoImage', __filename); await k.waitForTimeout(600);
  t('управление: файл, който не е снимка, се отказва', (await k.textContent('#promoErr')).includes('само снимки'), await k.textContent('#promoErr'));
  await k.click('#promoReset');
  await k.click('[data-tab="stores"]'); await k.waitForTimeout(400);
  t('управление: списък с 18 магазина', (await k.$$('#storeRows tr')).length === 18);
  await k.click('#storeRows tr button'); await k.waitForTimeout(200);
  t('управление: формата на магазина се попълва с работното време', (await k.inputValue('#storeName')).length > 2 && ((await k.isChecked('#storeAlways')) || /^\d\d:\d\d$/.test(await k.inputValue('#storeFrom0')) || (await k.inputValue('#storeDay0')) !== 'open'));
  await k.screenshot({ path: OUT + '/11-upravlenie-magazini.png', fullPage: false });
  await k.click('[data-tab="customers"]'); await k.waitForTimeout(400);
  t('управление: клиентът е в списъка', (await k.textContent('#customerRows')).includes('Мария Петрова'));

  // ---- новини в приложението ----
  await tab('home');
  await p.waitForSelector(id('moreDot'));
  t('новини: има знак за непрочетена', true);
  await more('news');
  await p.waitForSelector('[data-testid^="news-"]');
  t('новини: новата е най-отгоре и има снимка', (await p.$eval('[data-testid^="news-"]', (e) => e.textContent)).includes('Нов магазин в Русе') && Boolean(await p.$('[data-testid^="news-"] img')));
  await p.waitForTimeout(400);
  t('новини: знакът изчезва след отваряне', (await p.$(id('moreDot'))) === null);
  await shot('12-novini');
  await tab('offers'); await p.waitForTimeout(400);
  const imgOk = await p.evaluate(async () => { const img = document.querySelector('img[src*="/uploads/"]'); if (!img) return false; if (!img.complete) await new Promise((r) => { img.onload = img.onerror = r; }); return img.naturalWidth > 0; });
  t('оферти: новата оферта се показва със снимката си', (await body()).includes('Мед от Странджа') && imgOk);
  await shot('13-oferta-sas-snimka');

  // ---- профил ----
  await more('profile');
  await p.fill(id('birthday'), '31.02'); await p.click(id('saveBirthday')); await p.waitForTimeout(400);
  t('профил: невъзможна дата се отказва', (await body()).includes('Напишете деня и месеца'));
  await p.fill(id('birthday'), '14.11'); await p.click(id('saveBirthday')); await p.waitForSelector(id('birthdayValue'));
  t('профил: рожденият ден е записан и вече не се сменя', (await txt('birthdayValue')) === '14.11' && (await p.$(id('birthday'))) === null);
  await shot('14-profil');
  await noOverflow('профил');

  // ---- без интернет ----
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForTimeout(1500);
  await phone.setOffline(true);
  await p.reload(); await p.waitForSelector(id('offlineBar'), { timeout: 15000 });
  t('без интернет: приложението се отваря и казва, че няма връзка', true);
  await tab('card');
  t('без интернет: картата показва същия код', (await txt('cardCode')).replace(/\s/g, '') === code && Boolean(await p.$(id('offlineNote'))));
  await shot('15-bez-internet');
  await phone.setOffline(false);
  await tab('home'); await p.waitForTimeout(800);
  t('с интернет лентата изчезва и точките са верни', (await p.$(id('offlineBar'))) === null && (await txt('points')) === '110');

  // ---- изход ----
  await more('profile'); await p.click(id('logout')); await p.waitForSelector(id('phone'));
  t('изход: връща към входа', true);

  const head = await (await fetch(SRV + '/sw.js')).headers.get('cache-control');
  t('sw.js и манифестът се сервират, без да се пазят от браузъра', head === 'no-cache' && (await fetch(SRV + '/manifest.json')).ok, String(head));
  const real = errors.filter((e) => !e.includes('status of 400') && !e.includes('ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to fetch'));
  t('без грешки в конзолата на приложението', real.length === 0, real.slice(0, 3).join(' / '));
  console.log(`\n${ok}/${ok + fail}`); console.log('КОД=' + code);
  await b.close();
})();
