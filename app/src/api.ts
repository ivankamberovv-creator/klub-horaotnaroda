// Връзката със сървъра на клуба. Когато приложението се отваря от сайта на клуба, сървърът е на същия адрес
// и нищо не се настройва. За телефон или за работа на компютъра адресът идва от EXPO_PUBLIC_API_URL (вижте README.md).
import { Platform } from 'react-native';

const fromEnv = process.env.EXPO_PUBLIC_API_URL;
export const API_URL = (fromEnv ?? (Platform.OS === 'web' ? '' : 'http://localhost:4100')).replace(/\/$/, '');
/** Снимките, качени на сървъра, идват като /uploads/…; тук стават пълен адрес */
export const mediaUrl = (url: string) => (url.startsWith('/') ? API_URL + url : url);

export type Me = {
  id: number; name: string; phone: string; cardCode: string; points: number; pointsPerEuro: number;
  nextReward: { title: string; costPoints: number; missing: number } | null;
  activePromotions: number; pendingRewards: number;
  birthday: string | null; favoriteStoreId: number | null; unreadNews: number;
};
export type Promotion = {
  id: number; title: string; tag: string; description: string;
  kind: 'discount' | 'double_points' | 'bonus_points' | 'info'; value: number; min_total_cents: number;
  ends_at: string | null; activated: boolean; image_url: string;
};
export type DayHours = [string, string] | null | '?';
export type Store = { id: number; name: string; city: string; address: string; phone: string; hours: DayHours[] | '24/7'; lat: number | null; lng: number | null };
export type NewsItem = { id: number; title: string; body: string; image_url: string; published_at: string };
export type HistoryItem = { id: number; delta: number; label: string; at: string };
export type HomeData = { me: Me; offers: Promotion[]; lastPurchase: Purchase | null; news: NewsItem[] };
export type Reward = { id: number; title: string; description: string; cost_points: number };
export type Redemption = { id: number; reward_title: string; points: number; status: 'pending' | 'issued' | 'cancelled'; created_at: string; resolved_at: string | null };
export type Purchase = { id: number; shop: string; total_cents: number; discount_cents: number; points_earned: number; purchased_at: string };
export type PurchaseDetail = Purchase & { items: { name: string; quantity: number; total_cents: number }[] };
export type Totals = { count: number; total_cents: number; discount_cents: number };

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let token: string | null = null;
let onUnauthorized: () => void = () => {};
export const setToken = (t: string | null) => { token = t; };
/** Какво да стане, когато сървърът каже, че входът вече не важи */
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 'Няма връзка със сървъра. Проверете интернета и опитайте пак.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new ApiError(data.error || 'server', data.message || 'Нещо се обърка. Опитайте пак след малко.', res.status);
  return data as T;
}

export const api = {
  requestCode: (phone: string) => call<{ sent: true; demoCode?: string }>('POST', '/api/auth/request-code', { phone }),
  verify: (phone: string, code: string) => call<{ token: string; isNew: boolean; me: Me }>('POST', '/api/auth/verify', { phone, code }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  me: () => call<Me>('GET', '/api/me'),
  setName: (name: string) => call<Me>('PUT', '/api/me', { name }),
  setProfile: (changes: { name?: string; birthday?: string; favoriteStoreId?: number | null }) => call<Me>('PUT', '/api/me', changes),
  home: () => call<HomeData>('GET', '/api/home'),
  history: () => call<{ points: number; history: HistoryItem[] }>('GET', '/api/points-history'),
  stores: () => call<{ stores: Store[] }>('GET', '/api/stores'),
  news: () => call<{ news: NewsItem[] }>('GET', '/api/news'),
  deleteAccount: () => call<{ ok: true }>('DELETE', '/api/me'),
  promotions: () => call<{ promotions: Promotion[] }>('GET', '/api/promotions'),
  activate: (id: number) => call<{ promotions: Promotion[] }>('POST', `/api/promotions/${id}/activate`),
  deactivate: (id: number) => call<{ promotions: Promotion[] }>('DELETE', `/api/promotions/${id}/activate`),
  rewards: () => call<{ points: number; rewards: Reward[]; redemptions: Redemption[] }>('GET', '/api/rewards'),
  redeem: (id: number) => call<{ redemption: Redemption; points: number; redemptions: Redemption[] }>('POST', `/api/rewards/${id}/redeem`),
  purchases: () => call<{ totals: Totals; purchases: Purchase[] }>('GET', '/api/purchases'),
  purchase: (id: number) => call<PurchaseDetail>('GET', `/api/purchases/${id}`),
};
