// Строи приложението за сайта на клуба: готовите файлове отиват в app/dist и сървърът ги сервира на адрес „/“.
// Оттам приложението се слага на началния екран на телефона, без магазин за приложения.
//   node tools/build-web.mjs
// Какво прави след самото строене: оправя страницата (език, манифест, иконки за iPhone) и пише sw.js,
// който пази файловете на приложението на телефона, за да се отваря и без интернет.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('../app', import.meta.url));
const dist = join(appDir, 'dist');

rmSync(dist, { recursive: true, force: true });
// без EXPO_PUBLIC_API_URL приложението търси сървъра на същия адрес, от който е отворено
execSync('npx expo export --platform web --output-dir dist', { cwd: appDir, stdio: 'inherit', env: { ...process.env, CI: '1' } });

// ---- страницата ----
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const must = (from, to) => {
  if (!html.includes(from)) throw new Error(`В index.html липсва очакваното „${from}“; шаблонът на Expo се е променил.`);
  html = html.replace(from, to);
};
must('<html lang="en">', '<html lang="bg">');
must('<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />');
must('</head>', `  <meta name="description" content="Карта за касата, точки от всяка покупка, оферти и награди в магазините „Хора от Народа“." />
    <meta name="theme-color" content="#0b5a42" />
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Хора от Народа" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <style>
      /* на голям екран приложението стои в колона с ширина на телефон */
      body { background: #f3f8f5; }
      #root { max-width: 520px; margin: 0 auto; background: #ffffff; }
    </style>
  </head>`);
must('<noscript> You need to enable JavaScript to run this app. </noscript>', '<noscript>Приложението има нужда от JavaScript. Включете го в настройките на браузъра.</noscript>');
must('</body>', `  <script>
      if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () { /* без него приложението пак работи, само не и без интернет */ }); });
    </script>
  </body>`);
writeFileSync(join(dist, 'index.html'), html);

// ---- работа без интернет ----
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push('/' + relative(dist, full).split('\\').join('/'));
  }
};
walk(dist);
const precache = ['/', ...files.filter((f) => !/(index\.html|metadata\.json|sw\.js|\.map)$/.test(f))];
const version = createHash('sha256').update(html).update(precache.join('\n')).digest('hex').slice(0, 12);

writeFileSync(join(dist, 'sw.js'), `// Написан от tools/build-web.mjs; не се редактира на ръка.
// Пази файловете на приложението на телефона. Данните (/api/) и страницата за служители никога не се пазят.
const CACHE = 'klub-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('klub-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;
  // самата страница: първо от мрежата, за да идват новите версии; без интернет, от запазеното
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')));
    return;
  }
  // файловете на приложението и снимките: от запазеното, иначе от мрежата (и се запазват)
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
    if (res.ok && /^\\/(_expo|assets|uploads)\\//.test(url.pathname)) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return res;
  })));
});
`);
console.log(`\nГотово: app/dist (${precache.length} файла за работа без интернет, версия ${version}).`);
