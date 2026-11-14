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
  for (const t of ['kasa', 'promotions', 'rewards', 'customers']) $('tab-' + t).hidden = t !== name;
  if (name === 'promotions') loadPromotions();
  if (name === 'rewards') loadRewards();
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

    el('div', { class: 'card' }, el('h3', {}, 'Активирани промоции'),
      c.promotions.length
        ? el('div', { class: 'list' }, ...c.promotions.map((p) => el('div', {}, el('div', {}, el('b', {}, p.title), el('p', { class: 'muted' }, promoText(p))))))
        : el('p', { class: 'muted' }, 'Клиентът не е активирал промоции.')),

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

// ---- промоции ----
const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
function promoFormFor(p) {
  $('promoId').value = p?.id ?? '';
  $('promoFormTitle').textContent = p ? 'Промяна на промоция' : 'Нова промоция';
  $('promoTitle').value = p?.title ?? '';
  $('promoTag').value = p?.tag ?? '';
  $('promoDescription').value = p?.description ?? '';
  $('promoKind').value = p?.kind ?? 'discount';
  $('promoValue').value = p && p.kind !== 'info' ? p.value : '';
  $('promoMin').value = p?.min_total_cents ? (p.min_total_cents / 100).toFixed(2) : '';
  $('promoStarts').value = localInput(p?.starts_at);
  $('promoEnds').value = localInput(p?.ends_at);
  $('promoActive').checked = p ? Boolean(p.active) : true;
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
  if (!promotions.length) $('promoRows').replaceChildren(el('tr', {}, el('td', { colspan: '5', class: 'muted' }, 'Още няма промоции.')));
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

promoFormFor(null);
if (session) enter();
