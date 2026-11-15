// Пази входа между пусканията: на телефона в защитеното хранилище, в браузър в localStorage.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'klub_token';
const ME_KEY = 'klub_me';

export async function loadToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) ?? null;
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}
export async function saveToken(token: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (token) globalThis.localStorage?.setItem(KEY, token);
      else globalThis.localStorage?.removeItem(KEY);
    } else if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // без памет приложението пак работи, само ще иска вход при следващото пускане
  }
}

/** Последно видяният профил: с него картата се показва и без интернет */
export async function loadCachedMe<T>(): Promise<T | null> {
  try {
    const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(ME_KEY) : await SecureStore.getItemAsync(ME_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export async function saveCachedMe(me: unknown | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (me) globalThis.localStorage?.setItem(ME_KEY, JSON.stringify(me));
      else globalThis.localStorage?.removeItem(ME_KEY);
    } else if (me) await SecureStore.setItemAsync(ME_KEY, JSON.stringify(me));
    else await SecureStore.deleteItemAsync(ME_KEY);
  } catch {
    // без памет картата просто няма да се вижда без интернет
  }
}
