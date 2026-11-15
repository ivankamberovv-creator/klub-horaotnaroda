// Къде е клиентът и колко далеч са магазините. Мястото се пита от браузъра и остава в телефона:
// разстоянията се смятат тук и нищо не се праща на сървъра.
export type Point = { lat: number; lng: number };

/** Разстояние по права линия между две точки, в километри (формулата на хаверсините) */
export function distanceKm(a: Point, b: Point): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 0.34 → „350 м“, 2.44 → „2,4 км“, 35.2 → „35 км“ */
export function formatDistance(km: number): string {
  if (km < 0.95) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} м`;
  const tenths = Math.round(km * 10) / 10;
  return tenths < 10 ? `${tenths.toFixed(1).replace('.', ',')} км` : `${Math.round(km)} км`;
}

/** Подрежда по разстояние от `here`; местата без координати отиват накрая, без разстояние */
export function byDistance<T extends { lat: number | null; lng: number | null }>(places: T[], here: Point): (T & { km: number | null })[] {
  return places
    .map((p) => ({ ...p, km: p.lat !== null && p.lng !== null ? distanceKm(here, { lat: p.lat, lng: p.lng }) : null }))
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
}

/** Пита браузъра къде е телефонът. При отказ или грешка хвърля Error с текст, който може да се покаже на клиента. */
export function locate(): Promise<Point> {
  const g = globalThis as { navigator?: { geolocation?: Geolocation }; isSecureContext?: boolean };
  if (!g.navigator?.geolocation) return Promise.reject(new Error('Този браузър не дава местоположение. Потърсете магазина по град.'));
  // браузърите дават местоположение само през защитена връзка (https) или на самия компютър (localhost)
  if (g.isSecureContext === false) return Promise.reject(new Error('Местоположението работи само през защитена връзка (https). Потърсете магазина по град.'));
  return new Promise((resolve, reject) => {
    g.navigator!.geolocation!.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.code === 1
        ? 'Не получихме достъп до местоположението Ви. Разрешете го в настройките на браузъра и опитайте пак.'
        : 'Не успяхме да определим къде сте. Опитайте пак или потърсете по град.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  });
}
