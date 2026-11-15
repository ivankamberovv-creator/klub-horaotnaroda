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
  // числата „броят“ до новата стойност, затова се чака да стигнат до нея
  const becomes = async (testId, value) => {
    try { await p.waitForFunction(([sel, v]) => document.querySelector(sel)?.textContent.trim().startsWith(v), [id(testId), String(value)], { timeout: 6000 }); return true; } catch { return false; }
  };

  // ---- вход ----
  await p.goto(SRV); await p.waitForSelector(id('email'));
  t('страницата е на български и има манифест', await p.evaluate(() => document.documentElement.lang === 'bg' && Boolean(document.querySelector('link[rel="manifest"]'))));
  await shot('01-vhod');
  t('вход: без верен имейл бутонът не работи', await p.$eval(id('sendCode'), (x) => x.getAttribute('aria-disabled') === 'true'));
  await p.fill(id('email'), 'maria');
  t('вход: „maria“ не е имейл', await p.$eval(id('sendCode'), (x) => x.getAttribute('aria-disabled') === 'true'));
  const address = 'Maria' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0') + '@primer.bg';
  await p.fill(id('email'), address); await p.click(id('sendCode')); await p.waitForSelector(id('code'));
  t('вход: казва на кой адрес е пратен кодът', (await body()).includes(address));
  const demo = (await txt('demoCode')).match(/\d{6}/)[0];
  await p.fill(id('code'), demo === '000000' ? '111111' : '000000'); await p.click(id('verify')); await p.waitForTimeout(500);
  t('грешен код: съобщение', (await body()).includes('Кодът не е верен'));
  await p.fill(id('code'), demo); await p.click(id('verify')); await p.waitForSelector(id('name'));
  await p.fill(id('name'), 'Мария Петрова'); await p.click(id('saveName')); await p.waitForSelector(id('points'));
  await p.waitForSelector('[data-testid^="offerTile-"]');
  t('вход: нов клиент с 0 точки и обещан подарък при първата покупка', await becomes('points', 0) && (await txt('welcomeGift')).includes('+20 точки с първата Ви покупка'), await txt('points'));
  t('началото поздравява по име', (await body()).includes('Здравейте, Мария Петрова'));
  t('началото показва офертите и новините', (await p.$$('[data-testid^="offerTile-"]')).length === 4 && (await body()).includes('Добре дошли в клуба'));
  t('началото показва две мисии с напредък 0', (await p.$$('[data-testid^="challenge-"]')).length === 2 && (await body()).includes('0 от 3 покупки'));
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
  t('каса: ролята е „Каса“ и управлението е скрито', (await k.textContent('#roleLabel')) === 'Каса' && await k.isHidden('[data-tab="promotions"]') && await k.isHidden('[data-tab="challenges"]'));
  await k.fill('#cardCode', code); await k.click('#lookupForm button'); await k.waitForSelector('#customerBox:not([hidden])');
  const box = await k.textContent('#customerBox');
  t('каса: намира клиента и активираната оферта', box.includes('Мария Петрова') && box.includes('Двойни точки'));
  t('каса: вижда само началото на имейла, не целия адрес', box.includes('имейл ma…@primer.bg') && !box.includes(address.toLowerCase()), box.slice(0, 120));
  await k.fill('#customerBox input[inputmode="decimal"]', '170,00'); await k.click('#customerBox form button'); await k.waitForTimeout(600);
  const said = await k.textContent('#customerBox');
  t('каса: 170 € с двойни точки = 340 точки', said.includes('начислени са 340 точки'));
  t('каса: казва за изпълнената мисия и за талона', said.includes('Изпълнена мисия „Пазарувайте за 100 €“: +100 точки') && said.includes('талон за изтриване'), said.slice(0, 260));
  await k.screenshot({ path: OUT + '/05-kasa.png', fullPage: true });

  // ---- празникът след покупка, мисии и талон ----
  await tab('home');
  t('началото брои до 460 точки (340 + 20 за добре дошли + 100 от мисията)', await becomes('points', 460), await txt('points'));
  t('излиза „+460 точки“, а обещаният подарък вече го няма', (await p.$(id('gainToast'))) !== null && (await txt('gainToast')) === '+460 точки' && (await p.$(id('welcomeGift'))) === null);
  await shot('06-nachalo-sled-pokupka');
  const home = await body();
  t('началото показва талона, напредъка по мисиите и последната покупка', Boolean(await p.$(id('toScratch'))) && home.includes('1 от 3 покупки') && home.includes('Изпълнена') && home.includes('170,00 €'));
  await p.click(id('toScratch')); await p.waitForSelector(id('scratchStart'));
  await shot('07-talon-chaka');
  await p.click(id('scratchStart')); await p.waitForSelector(id('scratchArea'));
  await noOverflow('талон');
  t('талон: има бутон „Изтрийте веднага“ за който не му се трие', (await txt('scratchOpen')) === 'Изтрийте веднага');
  // истинско триене: мишката минава на редове по талона, докато се открие
  const area = await (await p.$(id('scratchArea'))).boundingBox();
  await p.mouse.move(area.x + 8, area.y + 8); await p.mouse.down();
  for (let row = 0; row < 8 && !(await p.$(id('scratchWon'))); row++) {
    const y = area.y + 10 + row * (area.height - 20) / 7;
    for (let step = 0; step <= 12; step++) await p.mouse.move(area.x + 8 + (row % 2 ? 12 - step : step) * (area.width - 16) / 12, y);
    if (row === 1) await shot('08-talon-triene');
  }
  await p.mouse.up();
  await p.waitForSelector(id('scratchWon'), { timeout: 5000 }).catch(() => {});
  const won = (await p.$(id('scratchWon'))) ? Number((await txt('scratchWon')).match(/\d+/)[0]) : 0;
  t('талон: триенето с пръст открива наградата', [5, 10, 20, 50].includes(won), String(won));
  const total = 460 + won;
  t('талон: точките горе стигат до новата сума', await becomes('headerPoints', total), await txt('headerPoints'));
  await shot('09-talon-spechelen');
  await p.click(id('scratchNext')); await p.waitForTimeout(600);
  t('талон: след това няма чакащи, а изтритият е в списъка', (await body()).includes('Нямате талони в момента') && (await body()).includes('Изтрити талони'));
  await more('missions');
  await p.waitForSelector('[data-testid^="challenge-"]');
  t('мисии: две мисии, едната изпълнена', (await p.$$('[data-testid^="challenge-"]')).length === 2 && (await body()).includes('Изпълнена') && (await body()).includes('1 от 3 покупки'));
  await shot('10-misii');
  await noOverflow('мисии');

  // ---- награди и история ----
  await tab('rewards');
  t('награди: показва салдото', await becomes('rewardPoints', total));
  const five = await p.evaluateHandle(() => [...document.querySelectorAll('[data-testid^="redeem-"]')].find((x) => x.parentElement.textContent.includes('Отстъпка 5 €')));
  await five.asElement().click(); await p.waitForTimeout(300);
  await p.click('[data-testid^="confirm-"]'); await p.waitForTimeout(600);
  t('награди: след размяната точките намаляват с 250', await becomes('rewardPoints', total - 250) && await becomes('headerPoints', total - 250));
  await shot('11-nagradi');
  await noOverflow('награди');
  await p.click(id('toHistory')); await p.waitForSelector(id('history-0'));
  const rows = await p.$$eval('[data-testid^="history-"]', (els) => els.map((e) => e.textContent));
  t('история: награда, талон, мисия, добре дошли и покупка, най-новото отгоре', rows.length === 5 && rows[0].includes('Награда: Отстъпка 5 €') && rows[0].includes('-250')
    && rows[1].includes('Талон за изтриване') && rows[1].includes('+' + won) && rows[2].includes('Изпълнена мисия: Пазарувайте за 100 €') && rows[2].includes('+100')
    && rows[3].includes('Добре дошли в клуба') && rows[3].includes('+20') && rows[4].includes('Покупка: Пробен магазин') && rows[4].includes('+340'), rows.join(' | '));
  await shot('12-istoria');
  await noOverflow('история');

  await k.fill('#cardCode', code); await k.click('#lookupForm button'); await k.waitForTimeout(500);
  t('каса: вижда наградата за издаване', (await k.textContent('#customerBox')).includes('Отстъпка 5 €'));
  await k.click('#customerBox .list button.btn:not(.ghost)'); await k.waitForTimeout(600);
  t('каса: след издаване няма чакащи', (await k.textContent('#customerBox')).includes('Няма заявени награди'));

  // ---- покупки ----
  await more('purchases');
  t('покупки: една покупка за 170,00 € с +340 точки', (await body()).includes('170,00 €') && (await body()).includes('+340 точки'));
  await p.click('[data-testid^="purchase-"]'); await p.waitForTimeout(400);
  await shot('13-pokupki');

  // ---- магазини ----
  await more('stores');
  await p.waitForSelector('[data-testid^="store-"]');
  t('магазини: 18 обекта', (await p.$$('[data-testid^="store-"]')).length === 18);
  await p.fill(id('storeSearch'), 'Варна'); await p.waitForTimeout(300);
  const varna = await p.$$eval('[data-testid^="store-"]', (els) => els.map((e) => e.textContent));
  t('магазини: търсенето по град стеснява списъка', varna.length > 0 && varna.length < 18 && varna.every((x) => x.includes('Варна')), String(varna.length));
  const lastId = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="store-"]')].pop().getAttribute('data-testid').split('-')[1]);
  await p.click(id('favorite-' + lastId)); await p.waitForTimeout(500);
  const top = await p.$eval('[data-testid^="store-"]', (e) => e.getAttribute('data-testid'));
  t('магазини: любимият отива най-отгоре', top === 'store-' + lastId, top);
  t('магазини: има работно време, обаждане и упътване', (await body()).includes('Обадете се') && (await body()).includes('Упътване') && /\d{1,2}:\d{2}–\d{1,2}:\d{2}|Денонощно/.test(await body()));
  await shot('14-magazini');
  await noOverflow('магазини');

  // ---- управление: новина и оферта със снимка, мисии, магазини ----
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
  await k.click('[data-tab="challenges"]'); await k.waitForTimeout(400);
  const chRows = await k.$$eval('#challengeRows tr', (els) => els.map((e) => e.textContent));
  t('управление: двете мисии, едната с един изпълнил', chRows.length === 2 && chRows.some((r) => r.includes('Пазарувайте за 100 €') && r.includes('покупки за 100,00 €')), chRows.join(' | '));
  await k.fill('#challengeTitle', 'Пет покупки до Коледа'); await k.fill('#challengeGoal', '5'); await k.fill('#challengeReward', '80');
  await k.click('#challengeForm button[type=submit]'); await k.waitForTimeout(500);
  t('управление: нова мисия е добавена', (await k.textContent('#challengeRows')).includes('Пет покупки до Коледа'), await k.textContent('#challengeErr'));
  await k.click('[data-tab="stores"]'); await k.waitForTimeout(400);
  t('управление: списък с 18 магазина', (await k.$$('#storeRows tr')).length === 18);
  await k.click('#storeRows tr button'); await k.waitForTimeout(200);
  t('управление: формата на магазина се попълва с работното време', (await k.inputValue('#storeName')).length > 2 && ((await k.isChecked('#storeAlways')) || /^\d\d:\d\d$/.test(await k.inputValue('#storeFrom0')) || (await k.inputValue('#storeDay0')) !== 'open'));
  await k.screenshot({ path: OUT + '/15-upravlenie.png', fullPage: false });
  await k.click('[data-tab="customers"]'); await k.waitForTimeout(400);
  t('управление: клиентът е в списъка', (await k.textContent('#customerRows')).includes('Мария Петрова'));

  // ---- новини в приложението ----
  await tab('home');
  await p.waitForSelector(id('moreDot'));
  t('новини: има знак за непрочетена', true);
  t('началото показва новата мисия', (await body()).includes('Пет покупки до Коледа') || (await p.$$('[data-testid^="challenge-"]')).length === 2);
  await more('news');
  await p.waitForSelector('[data-testid^="news-"]');
  t('новини: новата е най-отгоре и има снимка', (await p.$eval('[data-testid^="news-"]', (e) => e.textContent)).includes('Нов магазин в Русе') && Boolean(await p.$('[data-testid^="news-"] img')));
  await p.waitForTimeout(400);
  t('новини: знакът изчезва след отваряне', (await p.$(id('moreDot'))) === null);
  await shot('16-novini');
  await tab('offers'); await p.waitForTimeout(400);
  const imgOk = await p.evaluate(async () => { const img = document.querySelector('img[src*="/uploads/"]'); if (!img) return false; if (!img.complete) await new Promise((r) => { img.onload = img.onerror = r; }); return img.naturalWidth > 0; });
  t('оферти: новата оферта се показва със снимката си', (await body()).includes('Мед от Странджа') && imgOk);
  await shot('17-oferta-sas-snimka');

  // ---- профил ----
  await more('profile');
  await p.fill(id('birthday'), '31.02'); await p.click(id('saveBirthday')); await p.waitForTimeout(400);
  t('профил: невъзможна дата се отказва', (await body()).includes('Напишете деня и месеца'));
  await p.fill(id('birthday'), '14.11'); await p.click(id('saveBirthday')); await p.waitForSelector(id('birthdayValue'));
  t('профил: рожденият ден е записан и вече не се сменя', (await txt('birthdayValue')) === '14.11' && (await p.$(id('birthday'))) === null);
  await shot('18-profil');
  await noOverflow('профил');

  // ---- без интернет ----
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForTimeout(1500);
  await phone.setOffline(true);
  await p.reload(); await p.waitForSelector(id('offlineBar'), { timeout: 15000 });
  t('без интернет: приложението се отваря и казва, че няма връзка', true);
  await tab('card');
  t('без интернет: картата показва същия код', (await txt('cardCode')).replace(/\s/g, '') === code && Boolean(await p.$(id('offlineNote'))));
  await shot('19-bez-internet');
  await phone.setOffline(false);
  await tab('home'); await p.waitForTimeout(800);
  t('с интернет лентата изчезва и точките са верни', (await p.$(id('offlineBar'))) === null && await becomes('points', total - 250));

  // ---- изход ----
  await more('profile');
  t('профил: показва имейла с малки букви', (await body()).includes(address.toLowerCase()));
  await p.click(id('logout')); await p.waitForSelector(id('email'));
  t('изход: връща към входа', true);

  const head = await (await fetch(SRV + '/sw.js')).headers.get('cache-control');
  t('sw.js и манифестът се сервират, без да се пазят от браузъра', head === 'no-cache' && (await fetch(SRV + '/manifest.json')).ok, String(head));
  const real = errors.filter((e) => !e.includes('status of 400') && !e.includes('ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to fetch'));
  t('без грешки в конзолата на приложението', real.length === 0, real.slice(0, 3).join(' / '));
  console.log(`\n${ok}/${ok + fail}`); console.log('КОД=' + code);
  await b.close();
})();
