// Демо каса: няма връзка с истинска касова програма. Покупките се въвеждат на ръка
// от страницата „Каса“ в управлението (POST /api/kasa/demo-purchase).

export function createDemoKasa() {
  return {
    name: 'demo',
    canSimulate: true,
    // няма откъде да се теглят продажби
    fetchSales: null,
  };
}
