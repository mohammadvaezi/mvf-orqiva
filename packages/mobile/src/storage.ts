// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  where the phone keeps things. The session (with its token) goes to the platform's secure
//          storage (Keychain, Keystore); the feed's offline cache to ordinary app storage. The browser
//          preview of the app has no secure storage and uses the page's storage instead.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { KeyValueStore } from '@orqiva/shared';
import { readSession, type Session } from './client';

const SESSION_KEY = 'orqiva.session';

export const cacheStore: KeyValueStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

const web = Platform.OS === 'web';

export async function loadSession(): Promise<Session | null> {
  try {
    const text = web
      ? globalThis.localStorage.getItem(SESSION_KEY)
      : await SecureStore.getItemAsync(SESSION_KEY);
    return readSession(text);
  } catch {
    return null;
  }
}

export async function saveSession(s: Session): Promise<void> {
  const text = JSON.stringify(s);
  if (web) globalThis.localStorage.setItem(SESSION_KEY, text);
  else
    await SecureStore.setItemAsync(SESSION_KEY, text, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
}

export async function clearSession(): Promise<void> {
  try {
    if (web) globalThis.localStorage.removeItem(SESSION_KEY);
    else await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // nothing stored: already signed out
  }
}
