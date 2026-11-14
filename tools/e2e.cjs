// Целият поток: приложението (в браузър с размер на телефон) + страницата на касата, срещу демо сървъра.
// Пуска се върху чиста демо база; вижте README.md, „Проверка от край до край“.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const APP = 'http://localhost:8082', SRV = 'http://localhost:4100', OUT = process.argv[2];
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
  const tab = async (x) => { await p.click(id('tab-' + x)); await p.waitForTimeout(500); };
  const noOverflow = async (name) => t(`${name}: няма хоризонтално превъртане`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await p.goto(APP); await p.waitForSelector(id('phone'));
  await p.screenshot({ path: OUT + '/01-vhod.png' });
  const number = '0888' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  await p.fill(id('phone'), number); await p.click(id('sendCode')); await p.waitForSelector(id('code'));
  const demo = (await txt('demoCode')).match(/\d{6}/)[0];
  await p.fill(id('code'), '000000' === demo ? '111111' : '000000'); await p.click(id('verify')); await p.waitForTimeout(500);
  t('грешен код: съобщение', (await p.textContent('body')).includes('Кодът не е верен'));
  await p.fill(id('code'), demo); await p.click(id('verify')); await p.waitForSelector(id('name'));
  await p.fill(id('name'), 'Мария Петрова'); await p.click(id('saveName')); await p.waitForSelector(id('points'));
  t('вход: нов клиент с 0 точки', (await txt('points')) === '0');
  t('началото поздравява по име', (await p.textContent('body')).includes('Здравейте, Мария Петрова'));
  await noOverflow('начало');
  await p.screenshot({ path: OUT + '/02-nachalo-0.png' });

  await tab('code');
  const code = (await txt('cardCode')).replace(/\s/g, '');
  t('кодът е 13 цифри с префикс 29', /^29\d{11}$/.test(code), code);
  await p.screenshot({ path: OUT + '/03-kod.png' });
  await noOverflow('моят код');

  await tab('promotions');
  const cards = await p.$$(`[data-testid^="activate-"]`);
  t('четири промоции за активиране', cards.length === 4, String(cards.length));
  // „Двойни точки“
  const doubleBtn = await p.evaluateHandle(() => [...document.querySelectorAll('[data-testid^="activate-"]')].find((x) => x.parentElement.textContent.includes('Двойни точки')));
  await doubleBtn.asElement().click(); await p.waitForTimeout(500);
  t('промоцията е активирана', (await p.textContent('body')).includes('Активирана'));
  await p.screenshot({ path: OUT + '/04-promotsii.png' });
  await noOverflow('промоции');

  // ---- касата ----
  const desk = await b.newContext({ viewport: { width: 1100, height: 800 } });
  const k = await desk.newPage();
  await k.goto(SRV + '/admin/'); await k.fill('#password', 'грешна'); await k.click('#loginForm button'); await k.waitForTimeout(300);
  t('каса: грешна парола се спира', (await k.textContent('#loginErr')).includes('Грешна парола'));
  await k.fill('#password', '1234'); await k.click('#loginForm button'); await k.waitForSelector('#cardCode');
  t('каса: ролята е „Каса“ и управлението е скрито', (await k.textContent('#roleLabel')) === 'Каса' && await k.isHidden('[data-tab="promotions"]'));
  await k.fill('#cardCode', code); await k.click('#lookupForm button'); await k.waitForSelector('#customerBox:not([hidden])');
  const box = await k.textContent('#customerBox');
  t('каса: намира клиента и активираната промоция', box.includes('Мария Петрова') && box.includes('Двойни точки'), box.slice(0, 80));
  await k.fill('#customerBox input[inputmode="decimal"]', '170,00'); await k.click('#customerBox form button'); await k.waitForTimeout(600);
  t('каса: 170 € с двойни точки = 340 точки', (await k.textContent('#customerBox')).includes('начислени са 340 точки'));
  await k.screenshot({ path: OUT + '/05-kasa.png', fullPage: true });

  // ---- обратно в приложението ----
  await tab('home');
  t('приложението показва 340 точки', (await txt('points')) === '340', await txt('points'));
  await p.screenshot({ path: OUT + '/06-nachalo-340.png' });
  await tab('rewards');
  t('награди: показва салдото', (await txt('rewardPoints')).startsWith('340'));
  t('награди: за екстракта не достигат 60', (await p.textContent('body')).includes('Не достигат 60 точки'));
  const five = await p.evaluateHandle(() => [...document.querySelectorAll('[data-testid^="redeem-"]')].find((x) => x.parentElement.textContent.includes('Отстъпка 5 €')));
  await five.asElement().click(); await p.waitForTimeout(300);
  await p.click('[data-testid^="confirm-"]'); await p.waitForTimeout(600);
  t('награди: след размяната остават 90 точки', (await txt('rewardPoints')).startsWith('90') && (await txt('headerPoints')) === '90');
  t('награди: чака на касата', (await p.textContent('body')).includes('За получаване на касата'));
  await p.screenshot({ path: OUT + '/07-nagradi.png' });
  await noOverflow('награди');

  await k.fill('#cardCode', code); await k.click('#lookupForm button'); await k.waitForTimeout(500);
  t('каса: вижда наградата за издаване', (await k.textContent('#customerBox')).includes('Отстъпка 5 €'));
  await k.click('#customerBox .list button.btn:not(.ghost)'); await k.waitForTimeout(600);
  t('каса: след издаване няма чакащи', (await k.textContent('#customerBox')).includes('Няма заявени награди'));

  await tab('purchases');
  const body = await p.textContent('body');
  t('покупки: една покупка за 170,00 € с +340 точки', body.includes('170,00 €') && body.includes('+340 точки') && body.includes('Пробен магазин'));
  await p.click('[data-testid^="purchase-"]'); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/08-pokupki.png' });
  await noOverflow('покупки');

  // входът се помни след презареждане
  await p.reload(); await p.waitForSelector(id('points'));
  t('след презареждане входът е запомнен', (await txt('points')) === '90');
  await tab('code'); await p.click(id('logout')); await p.waitForSelector(id('phone'));
  t('изход: връща към входа', true);

  // ---- управление ----
  await k.click('#logout'); await k.fill('#password', 'demo-admin'); await k.click('#loginForm button'); await k.waitForSelector('#cardCode');
  await k.click('[data-tab="promotions"]'); await k.waitForTimeout(400);
  t('управление: списък с 4 промоции', (await k.$$('#promoRows tr')).length === 4);
  await k.fill('#promoTitle', '−10% на меда'); await k.fill('#promoTag', 'Ноември'); await k.fill('#promoValue', '10'); await k.click('#promoForm button[type=submit]'); await k.waitForTimeout(400);
  t('управление: нова промоция е добавена', (await k.textContent('#promoRows')).includes('−10% на меда'));
  await k.click('[data-tab="customers"]'); await k.waitForTimeout(400);
  t('управление: клиентът е в списъка', (await k.textContent('#customerRows')).includes('Мария Петрова'));
  await k.screenshot({ path: OUT + '/09-upravlenie.png', fullPage: true });

  const real = errors.filter((e) => !e.includes('status of 400')); // 400 е нарочно грешният код
  t('без грешки в конзолата на приложението', real.length === 0, real.slice(0, 3).join(' / '));
  console.log(`\n${ok}/${ok + fail}`); console.log('КОД=' + code);
  await b.close();
})();
