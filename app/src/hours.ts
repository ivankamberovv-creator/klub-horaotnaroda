// Работното време на магазините: текст за показване и „отворено ли е сега“.
// Времето е „24/7“ или седем полета от понеделник до неделя: [от, до], null (почивен ден) или „?“ (не е посочено).

export type DayHours = [string, string] | null | '?';
export type Hours = DayHours[] | '24/7';

const DAYS = ['Пон', 'Вт', 'Ср', 'Чет', 'Пет', 'Съб', 'Нед'];
const say = (d: DayHours) => (d === null ? 'почивен ден' : d === '?' ? 'уточнете по телефона' : `${d[0]}–${d[1]}`);

/** Работното време на редове, като еднаквите съседни дни се събират: „Пон–Пет 8:00–20:00“ */
export function hoursLines(hours: Hours): string[] {
  if (hours === '24/7') return ['Денонощно'];
  if (hours.length !== 7) return [];
  const lines: string[] = [];
  for (let i = 0; i < 7;) {
    let j = i;
    while (j + 1 < 7 && JSON.stringify(hours[j + 1]) === JSON.stringify(hours[i])) j++;
    const days = i === 0 && j === 6 ? 'Всеки ден' : i === j ? DAYS[i] : `${DAYS[i]}–${DAYS[j]}`;
    lines.push(`${days} ${say(hours[i])}`);
    i = j + 1;
  }
  return lines;
}

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Отворено ли е в този момент: true, false или null, когато за днес няма посочено време */
export function openNow(hours: Hours, now = new Date()): boolean | null {
  if (hours === '24/7') return true;
  if (hours.length !== 7) return null;
  const today = hours[(now.getDay() + 6) % 7]; // getDay() брои от неделя, а списъкът започва от понеделник
  if (today === null) return false;
  if (today === '?') return null;
  const t = now.getHours() * 60 + now.getMinutes(), from = minutes(today[0]), to = minutes(today[1]);
  return to > from ? t >= from && t < to : t >= from || t < to; // вторият случай е работа след полунощ
}
