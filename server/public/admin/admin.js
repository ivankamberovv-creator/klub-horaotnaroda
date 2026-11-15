// Страницата за служители: каса (за всички) и управление (само с паролата за управление).
'use strict';

const $ = (id) => document.getElementById(id);
const euro = (cents) => (cents / 100).toFixed(2).replace('.', ',') + ' €';
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const KINDS = { discount: 'Отстъпка', double_points: 'Точки по няколко', bonus_points: 'Точки отгоре', info: 'Съобщение' };
let session = null;
try { session = JSON.parse(sessionStorage.getItem('klub-staff') || 'null'); } catch { /* без памет */ }

/** Заявка към сървъра; при грешка хвърля текста, който сървърът е върнал */
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session) { leave(); throw new Error('Влезте отново.'); }
  if (!res.ok) throw new Error(data.message || 'Нещо се обърка. Опитайте пак.');
  return data;
}
/** Създава елемент: el('td', { class: 'num' }, 'текст', друг елемент…) */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}
const show = (node, text) => { node.textContent = text || ''; node.hidden = !text; };

// ---- вход и изход ----
function enter() {
  $('login').hidden = true;
  $('app').hidden = false;
  $('roleLabel').textContent = session.role === 'admin' ? 'Управление' : 'Каса';
  document.querySelectorAll('[data-admin]').forEach((b) => { b.hidden = session.role !== 'admin'; });
  openTab('kasa');
  $('cardCode').focus();
}
function leave() {
  session = null;
  try { sessionStorage.removeItem('klub-staff'); } catch { /* без памет */ }
  $('app').hidden = true;
  $('login').hidden = false;
  $('customerBox').hidden = true;
}
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  show($('loginErr'), '');
  try {
    session = await api('POST', '/api/staff/login', { password: $('password').value });
    try { sessionStorage.setItem('klub-staff', JSON.stringify(session)); } catch { /* без памет */ }
    $('password').value = '';
    enter();
  } catch (err) { session = null; show($('loginErr'), err.message); }
});
$('logout').addEventListener('click', leave);

// ---- раздели ----
function openTab(name) {
  document.querySelectorAll('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  for (const t of ['kasa', 'promotions', 'rewards', 'stores', 'news', 'customers']) $('tab-' + t).hidden = t !== name;
  if (name === 'promotions') loadPromotions();
  if (name === 'rewards') loadRewards();
  if (name === 'stores') loadStores();
  if (name === 'news') loadNews();
  if (name === 'customers') loadCustomers();
}
document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));

// ---- каса ----
let current = null;
async function lookup(code) {
  show($('lookupErr'), '');
  try {
    current = await api('GET', '/api/kasa/customer/' + encodeURIComponent(code));
    renderCustomer();
  } catch (err) { $('customerBox').hidden = true; show($('lookupErr'), err.message); }
}
$('lookupForm').addEventListener('submit', (e) => { e.preventDefault(); lookup($('cardCode').value.replace(/\D/g, '')); });

function renderCustomer(message = '') {
  const c = current, box = $('customerBox');
  const resolve = async (id, action) => {
    try {
      await api('POST', `/api/kasa/redemptions/${id}/${action}`);
      await lookup(c.customer.cardCode);
    } catch (err) { show($('lookupErr'), err.message); }
  };
  const promoText = (p) => (p.kind === 'discount' ? `${p.value}% отстъпка: приложете я в касата`
    : p.kind === 'double_points' ? `${p.value === 2 ? 'Двойни точки' : 'Точки по ' + p.value}: смятат се сами`
      : p.kind === 'bonus_points' ? `+${p.value} точки при покупка над ${euro(p.min_total_cents)}: смятат се сами` : 'Съобщение');

  box.replaceChildren(
    el('div', { class: 'card paper' },
      el('div', { class: 'row' },
        el('div', {}, el('p', { class: 'eyebrow' }, 'Клиент'), el('h2', {}, c.customer.name || 'Без име'),
          el('p', { class: 'muted' }, `Код ${c.customer.cardCode} · телефон, завършващ на ${c.customer.phoneTail}`)),
        el('div', { class: 'fit', style: 'text-align:right' }, el('p', { class: 'big' }, String(c.points)), el('p', { class: 'muted' }, 'точки'))),
      message ? el('p', { class: 'ok', role: 'status' }, message) : null),

    el('div', { class: 'card' }, el('h3', {}, 'Активирани оферти'),
      c.promotions.length
        ? el('div', { class: 'list' }, ...c.promotions.map((p) => el('div', {}, el('div', {}, el('b', {}, p.title), el('p', { class: 'muted' }, promoText(p))))))
        : el('p', { class: 'muted' }, 'Клиентът не е активирал оферти.')),

    el('div', { class: 'card' }, el('h3', {}, 'Награди за издаване'),
      c.pendingRewards.length
        ? el('div', { class: 'list' }, ...c.pendingRewards.map((r) => el('div', {},
          el('div', {}, el('b', {}, r.reward_title), el('p', { class: 'muted' }, `${r.points} точки · заявена на ${day(r.created_at)}`)),
          el('div', { class: 'row fit' },
            el('button', { class: 'btn small fit', type: 'button', onclick: () => resolve(r.id, 'issue') }, 'Издайте'),
            el('button', { class: 'btn ghost small fit', type: 'button', onclick: () => resolve(r.id, 'cancel') }, 'Откажете')))))
        : el('p', { class: 'muted' }, 'Няма заявени награди.')),

    c.canSimulate ? demoPurchaseForm() : el('p', { class: 'muted' }, 'Покупките и точките идват от касовата програма.'),
  );
  box.hidden = false;
}

function demoPurchaseForm() {
  const total = el('input', { inputmode: 'decimal', placeholder: '0,00', required: true });
  const discount = el('input', { inputmode: 'decimal', placeholder: '0,00' });
  const shop = el('input', { value: 'Пробен магазин', maxlength: '80' });
  const err = el('p', { class: 'err', role: 'alert', hidden: true });
  const cents = (v) => Math.round(parseFloat(String(v || '0').replace(',', '.')) * 100);
  return el('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      show(err, '');
      try {
        const r = await api('POST', '/api/kasa/demo-purchase', { cardCode: current.customer.cardCode, totalCents: cents(total.value), discountCents: cents(discount.value), shop: shop.value });
        current = await api('GET', '/api/kasa/customer/' + current.customer.cardCode);
        renderCustomer(`Записана покупка за ${euro(r.purchase.total_cents)}: начислени са ${r.purchase.points_earned} точки.`);
      } catch (error) { show(err, error.message); }
    },
  },
  el('h3', {}, 'Пробна покупка'),
  el('p', { class: 'muted' }, 'Само докато няма връзка с касовата програма. Записва покупка и начислява точките.'),
  el('div', { class: 'row' }, el('label', {}, 'Платена сума, €', total), el('label', {}, 'Отстъпка, €', discount), el('label', {}, 'Магазин', shop)),
  err, el('button', { class: 'btn', type: 'submit' }, 'Запишете покупката'));
}

// ---- снимки към оферти и новини ----
/** Връзва поле за файл с кутийка за преглед. Снимката се качва веднага и се помни адресът ѝ. */
function imageField(prefix, errNode) {
  let current = '';
  const set = (url) => {
    current = url || '';
    $(prefix + 'Image').value = '';
    $(prefix + 'ImageBox').hidden = !current;
    if (current) $(prefix + 'ImagePreview').src = current;
  };
  $(prefix + 'Image').addEventListener('change', async () => {
    const file = $(prefix + 'Image').files[0];
    if (!file) return;
    show(errNode, '');
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Файлът не можа да се прочете.'));
        reader.readAsDataURL(file);
      });
      set((await api('POST', '/api/admin/upload', { data })).url);
    } catch (err) { set(current); show(errNode, err.message); }
  });
  $(prefix + 'ImageRemove').addEventListener('click', () => set(''));
  return { set, url: () => current };
}
const promoImage = imageField('promo', $('promoErr'));
const newsImage = imageField('news', $('newsErr'));

// ---- промоции ----
const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
function promoFormFor(p) {
  $('promoId').value = p?.id ?? '';
  $('promoFormTitle').textContent = p ? 'Промяна на оферта' : 'Нова оферта';
  $('promoTitle').value = p?.title ?? '';
  $('promoTag').value = p?.tag ?? '';
  $('promoDescription').value = p?.description ?? '';
  $('promoKind').value = p?.kind ?? 'discount';
  $('promoValue').value = p && p.kind !== 'info' ? p.value : '';
  $('promoMin').value = p?.min_total_cents ? (p.min_total_cents / 100).toFixed(2) : '';
  $('promoStarts').value = localInput(p?.starts_at);
  $('promoEnds').value = localInput(p?.ends_at);
  $('promoActive').checked = p ? Boolean(p.active) : true;
  promoImage.set(p?.image_url ?? '');
  show($('promoErr'), '');
  promoKindChanged();
}
function promoKindChanged() {
  const kind = $('promoKind').value;
  $('promoValueLabel').hidden = kind === 'info';
  $('promoMinLabel').hidden = kind !== 'bonus_points';
  $('promoValueLabel').firstChild.textContent = kind === 'discount' ? 'Отстъпка, %' : kind === 'double_points' ? 'Множител (2 = двойни)' : 'Точки отгоре';
}
$('promoKind').addEventListener('change', promoKindChanged);
$('promoReset').addEventListener('click', () => promoFormFor(null));
$('promoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const kind = $('promoKind').value, id = $('promoId').value;
  const body = {
    title: $('promoTitle').value, tag: $('promoTag').value, description: $('promoDescription').value, kind,
    value: kind === 'info' ? 0 : Number($('promoValue').value),
    min_total_cents: kind === 'bonus_points' ? Math.round(parseFloat(($('promoMin').value || '0').replace(',', '.')) * 100) : 0,
    starts_at: $('promoStarts').value ? new Date($('promoStarts').value).toISOString() : null,
    ends_at: $('promoEnds').value ? new Date($('promoEnds').value).toISOString() : null,
    active: $('promoActive').checked,
    image_url: promoImage.url(),
  };
  try {
    await api(id ? 'PUT' : 'POST', '/api/admin/promotions' + (id ? '/' + id : ''), body);
    promoFormFor(null);
    loadPromotions();
  } catch (err) { show($('promoErr'), err.message); }
});
async function loadPromotions() {
  const { promotions } = await api('GET', '/api/admin/promotions');
  const what = (p) => (p.kind === 'discount' ? `${p.value}%` : p.kind === 'double_points' ? `× ${p.value}` : p.kind === 'bonus_points' ? `+${p.value} над ${euro(p.min_total_cents)}` : '');
  $('promoRows').replaceChildren(...promotions.map((p) => el('tr', { class: p.active ? '' : 'off' },
    el('td', {}, el('b', {}, p.title), p.active ? '' : ' (спряна)'),
    el('td', {}, `${KINDS[p.kind]} ${what(p)}`),
    el('td', {}, p.ends_at ? day(p.ends_at) : 'без край'),
    el('td', { class: 'num' }, String(p.activations)),
    el('td', {}, el('button', { class: 'btn ghost small', type: 'button', onclick: () => { promoFormFor(p); $('promoTitle').focus(); } }, 'Променете')))));
  if (!promotions.length) $('promoRows').replaceChildren(el('tr', {}, el('td', { colspan: '5', class: 'muted' }, 'Още няма оферти.')));
}

// ---- награди ----
function rewardFormFor(r) {
  $('rewardId').value = r?.id ?? '';
  $('rewardFormTitle').textContent = r ? 'Промяна на награда' : 'Нова награда';
  $('rewardTitle').value = r?.title ?? '';
  $('rewardCost').value = r?.cost_points ?? '';
  $('rewardDescription').value = r?.description ?? '';
  $('rewardActive').checked = r ? Boolean(r.active) : true;
  show($('rewardErr'), '');
}
$('rewardReset').addEventListener('click', () => rewardFormFor(null));
$('rewardForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('rewardId').value;
  const body = { title: $('rewardTitle').value, description: $('rewardDescription').value, cost_points: Number($('rewardCost').value), active: $('rewardActive').checked };
  try {
    await api(id ? 'PUT' : 'POST', '/api/admin/rewards' + (id ? '/' + id : ''), body);
    rewardFormFor(null);
    loadRewards();
  } catch (err) { show($('rewardErr'), err.message); }
});
async function loadRewards() {
  const { rewards } = await api('GET', '/api/admin/rewards');
  $('rewardRows').replaceChildren(...rewards.map((r) => el('tr', { class: r.active ? '' : 'off' },
    el('td', {}, el('b', {}, r.title), r.active ? '' : ' (спряна)'),
    el('td', { class: 'num' }, String(r.cost_points)),
    el('td', {}, el('button', { class: 'btn ghost small', type: 'button', onclick: () => { rewardFormFor(r); $('rewardTitle').focus(); } }, 'Променете')))));
  if (!rewards.length) $('rewardRows').replaceChildren(el('tr', {}, el('td', { colspan: '3', class: 'muted' }, 'Още няма награди.')));
}

// ---- магазини ----
const DAY_NAMES = ['Пон', 'Вт', 'Ср', 'Чет', 'Пет', 'Съб', 'Нед'];
/** Седемте реда за работното време: състояние (отворено, почивен ден, не е посочено) и часове от–до */
function buildHoursRows() {
  $('storeHours').replaceChildren(...DAY_NAMES.map((name, i) => {
    const state = el('select', { id: `storeDay${i}`, 'aria-label': `${name}: състояние` },
      el('option', { value: 'open' }, 'Отворено'), el('option', { value: 'closed' }, 'Почивен ден'), el('option', { value: 'unknown' }, 'Не е посочено'));
    const from = el('input', { id: `storeFrom${i}`, type: 'time', 'aria-label': `${name}: от` });
    const to = el('input', { id: `storeTo${i}`, type: 'time', 'aria-label': `${name}: до` });
    state.addEventListener('change', () => { from.hidden = to.hidden = state.value !== 'open'; });
    return el('div', { class: 'dayrow' }, el('b', {}, name), state, from, to);
  }));
}
const pad = (t) => (t && t.length === 4 ? '0' + t : t || '');          // „8:00“ → „08:00“ за полето за час
const unpad = (t) => t.replace(/^0(\d:)/, '$1');                        // „08:00“ → „8:00“, както се показва
function setHours(hours) {
  const always = hours === '24/7';
  $('storeAlways').checked = always;
  $('storeHours').hidden = always;
  for (let i = 0; i < 7; i++) {
    const d = Array.isArray(hours) && hours.length === 7 ? hours[i] : ['8:00', '20:00'];
    $(`storeDay${i}`).value = d === null ? 'closed' : d === '?' ? 'unknown' : 'open';
    $(`storeFrom${i}`).value = Array.isArray(d) ? pad(d[0]) : '08:00';
    $(`storeTo${i}`).value = Array.isArray(d) ? pad(d[1]) : '20:00';
    $(`storeFrom${i}`).hidden = $(`storeTo${i}`).hidden = !Array.isArray(d);
  }
}
function readHours() {
  if ($('storeAlways').checked) return '24/7';
  return DAY_NAMES.map((_, i) => {
    const state = $(`storeDay${i}`).value;
    return state === 'closed' ? null : state === 'unknown' ? '?' : [unpad($(`storeFrom${i}`).value), unpad($(`storeTo${i}`).value)];
  });
}
$('storeAlways').addEventListener('change', () => { $('storeHours').hidden = $('storeAlways').checked; });
function storeFormFor(st) {
  $('storeId').value = st?.id ?? '';
  $('storeFormTitle').textContent = st ? 'Промяна на магазин' : 'Нов магазин';
  $('storeName').value = st?.name ?? '';
  $('storeCity').value = st?.city ?? '';
  $('storeAddress').value = st?.address ?? '';
  $('storePhone').value = st?.phone ?? '';
  $('storeLat').value = st?.lat ?? '';
  $('storeLng').value = st?.lng ?? '';
  $('storeActive').checked = st ? Boolean(st.active) : true;
  setHours(st?.hours ?? []);
  show($('storeErr'), '');
}
$('storeReset').addEventListener('click', () => storeFormFor(null));
$('storeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('storeId').value;
  const num = (v) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const body = { name: $('storeName').value, city: $('storeCity').value, address: $('storeAddress').value, phone: $('storePhone').value,
    hours: readHours(), lat: num($('storeLat').value), lng: num($('storeLng').value), active: $('storeActive').checked };
  try {
    await api(id ? 'PUT' : 'POST', '/api/admin/stores' + (id ? '/' + id : ''), body);
    storeFormFor(null);
    loadStores();
  } catch (err) { show($('storeErr'), err.message); }
});
async function loadStores() {
  const { stores } = await api('GET', '/api/admin/stores');
  $('storeRows').replaceChildren(...stores.map((st) => el('tr', { class: st.active ? '' : 'off' },
    el('td', {}, el('b', {}, st.name), st.active ? '' : ' (скрит)'), el('td', {}, st.address), el('td', {}, st.phone),
    el('td', {}, el('button', { class: 'btn ghost small', type: 'button', onclick: () => { storeFormFor(st); $('storeName').focus(); } }, 'Променете')))));
  if (!stores.length) $('storeRows').replaceChildren(el('tr', {}, el('td', { colspan: '4', class: 'muted' }, 'Още няма магазини.')));
}

// ---- новини ----
function newsFormFor(n) {
  $('newsId').value = n?.id ?? '';
  $('newsFormTitle').textContent = n ? 'Промяна на новина' : 'Нова новина';
  $('newsTitle').value = n?.title ?? '';
  $('newsBody').value = n?.body ?? '';
  $('newsDate').value = n ? localInput(n.published_at) : '';
  $('newsActive').checked = n ? Boolean(n.active) : true;
  newsImage.set(n?.image_url ?? '');
  show($('newsErr'), '');
}
$('newsReset').addEventListener('click', () => newsFormFor(null));
$('newsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('newsId').value;
  const body = { title: $('newsTitle').value, body: $('newsBody').value, image_url: newsImage.url(),
    published_at: $('newsDate').value ? new Date($('newsDate').value).toISOString() : null, active: $('newsActive').checked };
  try {
    await api(id ? 'PUT' : 'POST', '/api/admin/news' + (id ? '/' + id : ''), body);
    newsFormFor(null);
    loadNews();
  } catch (err) { show($('newsErr'), err.message); }
});
async function loadNews() {
  const { news } = await api('GET', '/api/admin/news');
  $('newsRows').replaceChildren(...news.map((n) => el('tr', { class: n.active ? '' : 'off' },
    el('td', {}, el('b', {}, n.title), n.active ? '' : ' (скрита)'), el('td', {}, day(n.published_at)),
    el('td', {}, el('button', { class: 'btn ghost small', type: 'button', onclick: () => { newsFormFor(n); $('newsTitle').focus(); } }, 'Променете')))));
  if (!news.length) $('newsRows').replaceChildren(el('tr', {}, el('td', { colspan: '3', class: 'muted' }, 'Още няма новини.')));
}

// ---- клиенти ----
async function loadCustomers() {
  const [stats, list] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/customers?q=' + encodeURIComponent($('customerQuery').value))]);
  const tile = (label, value) => el('div', { class: 'card' }, el('p', { class: 'muted' }, label), el('p', { class: 'big' }, value));
  $('stats').replaceChildren(tile('Клиенти', String(stats.customers)), tile('Покупки', String(stats.purchases)),
    tile('Оборот през клуба', euro(stats.turnoverCents)), tile('Неизползвани точки', String(stats.pointsOutstanding)), tile('Награди за издаване', String(stats.pendingRewards)));
  $('customerRows').replaceChildren(...list.customers.map((c) => el('tr', {},
    el('td', {}, c.name || 'Без име'), el('td', {}, c.phone), el('td', {}, c.card_code),
    el('td', { class: 'num' }, String(c.points)), el('td', { class: 'num' }, String(c.purchases)), el('td', { class: 'num' }, euro(c.spent_cents)))));
  if (!list.customers.length) $('customerRows').replaceChildren(el('tr', {}, el('td', { colspan: '6', class: 'muted' }, 'Няма клиенти.')));
}
let searchTimer = 0;
$('customerQuery').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadCustomers, 250); });

buildHoursRows();
promoFormFor(null);
storeFormFor(null);
newsFormFor(null);
if (session) enter();
