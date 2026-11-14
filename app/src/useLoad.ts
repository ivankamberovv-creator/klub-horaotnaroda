// Зарежда данните на един екран: първо зареждане, дърпане за обновяване и съобщение при грешка.
import { useCallback, useEffect, useState } from 'react';

export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(async (pulled = false) => {
    if (pulled) setRefreshing(true);
    try {
      setData(await load());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
    } finally {
      setRefreshing(false);
    }
    // зареждането е едно и също през целия живот на екрана
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { run(); }, [run]);
  return { data, setData, error, setError, refreshing, refresh: () => run(true), reload: () => run(false) };
}
