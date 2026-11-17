// Касата е сменяем модул: сървърът работи еднакво с демо касата и с истинска касова програма.
// Всеки модул дава: name, canSimulate и fetchSales(sinceIso) → [{ externalId, cardCode, shop, totalCents,
// discountCents, purchasedAt, items: [{ name, quantity, totalCents }] }] (или null, ако няма откъде да тегли).
import { createDemoKasa } from './demo.js';
import { createYanakKasa } from './yanak.js';
import { createVamibexKasa } from './vamibex.js';

export function createKasa(config) {
  if (config.kasa === 'demo') return createDemoKasa();
  if (config.kasa === 'yanak') return createYanakKasa(config.yanak);
  if (config.kasa === 'vamibex') return createVamibexKasa();
  throw new Error(`Непозната каса „${config.kasa}“. Възможни са: demo, vamibex, yanak.`);
}
