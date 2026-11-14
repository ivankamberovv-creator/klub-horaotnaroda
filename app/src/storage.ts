// Пази входа между пусканията: на телефона в защитеното хранилище, в браузър в localStorage.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'klub_token';

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
