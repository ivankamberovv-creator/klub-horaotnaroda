// Vamibex POS: продажбите не се теглят от сървъра, а идват сами. На всяка каса работи локален конектор
// (connector/vamibex-pos-connector.mjs), който чете приключените продажби от касата и ги праща тук,
// на POST /api/loyalty/v1/events. Затова този модул няма fetchSales. Вижте docs/vamibex-pos.md.

export function createVamibexKasa() {
  return {
    name: 'vamibex',
    canSimulate: false,
    fetchSales: null,
  };
}
