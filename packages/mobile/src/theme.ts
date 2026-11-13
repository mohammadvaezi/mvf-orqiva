// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  the web app's design tokens (packages/web/src/theme.css), light and dark, so the phone reads
//          as the same product: the same purple, the same quiet greys, the same dense rhythm.
import { useColorScheme } from 'react-native';
import type { Tone } from './rows';

export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  text2: string;
  border: string;
  primary: string;
  primaryText: string;
  primaryContainer: string;
  error: string;
  errorBg: string;
  success: string;
  warn: string;
  tones: Record<Tone, string>;
}

const LIGHT: Theme = {
  dark: false,
  bg: '#f7f7fc',
  surface: '#ffffff',
  surface2: '#f7f7fc',
  text: '#23224a',
  text2: '#7f7e9c',
  border: '#ecebf4',
  primary: '#4b3fce',
  primaryText: '#ffffff',
  primaryContainer: '#ebe9ff',
  error: '#b42318',
  errorBg: '#fef1f0',
  success: '#16794a',
  warn: '#b54708',
  tones: {
    work: '#4b3fce',
    agent: '#7a3fce',
    ship: '#0e7490',
    quality: '#16794a',
    risk: '#b42318',
    people: '#7f7e9c',
  },
};

const DARK: Theme = {
  dark: true,
  bg: '#14132b',
  surface: '#1c1b3a',
  surface2: '#22214a',
  text: '#ecebff',
  text2: '#a4a3c8',
  border: '#2c2b52',
  primary: '#9a92ff',
  primaryText: '#15113f',
  primaryContainer: '#2e2878',
  error: '#ff8a80',
  errorBg: '#3a1d1d',
  success: '#4ade80',
  warn: '#fbbf24',
  tones: {
    work: '#9a92ff',
    agent: '#c4a5ff',
    ship: '#67e8f9',
    quality: '#4ade80',
    risk: '#ff8a80',
    people: '#a4a3c8',
  },
};

export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 } as const;
export const FONT = { small: 12, body: 14, title: 17, large: 22 } as const;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}
