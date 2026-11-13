// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  the app's frame: it restores the session from secure storage, shows the sign-in until there is
//          one, and then the live feed from the shared feed core. The socket carries the device token in
//          its Authorization header. Coming back to the front reconnects at once and checks the session;
//          a server that answers 401 means the phone was signed out in the web app, so it forgets the
//          session and the cache and says so.
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Feed, parsePairingLink, type FeedState, type SocketLike } from '@orqiva/shared';
import { fetchPage, revoke, SignedOutError, socketUrl, type Session } from './client';
import { Main } from './Main'; // [PCODE-228 | S15 | v0.1.0]
import { PairScreen } from './PairScreen';
import { cacheStore, clearSession, loadSession, saveSession } from './storage';
import { useTheme } from './theme';
import { EventHub } from './useLive';

/** React Native's WebSocket takes headers as a third argument; the browser's does not. */
type NativeWebSocket = new (
  url: string,
  protocols?: string | string[] | null,
  options?: { headers: Record<string, string> },
) => SocketLike;

const EMPTY: FeedState = { events: [], status: 'connecting', cachedAt: null, error: null };

export function App(): ReactNode {
  const t = useTheme();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<FeedState>(EMPTY);
  const feed = useRef<Feed | null>(null);
  // [PCODE-228 | S15 | v0.1.0] live events for the map and the screens; a 401 there signs out too
  const [hub] = useState(() => new EventHub());
  const url = Linking.useLinkingURL();
  const link = url ? parsePairingLink(url) : null;

  useEffect(() => {
    void loadSession().then((s) => {
      setSession(s);
      setReady(true);
    });
  }, []);

  const signedOut = useCallback(async (why: string | null) => {
    await feed.current?.forget();
    feed.current = null;
    await clearSession();
    setState(EMPTY);
    setSession(null);
    setNotice(why);
  }, []);

  // the feed follows the session: one per signed-in workspace
  useEffect(() => {
    if (!session) return;
    const s = session;
    const f = new Feed({
      server: s.server,
      workspaceId: s.workspace.id,
      store: cacheStore,
      open: (path) => {
        const url = socketUrl(s.server, path);
        // a browser (the preview) has no headers on a socket and fails on the third argument; its
        // page reaches the server through a proxy that signs it in
        if (Platform.OS === 'web') return new WebSocket(url) as unknown as SocketLike;
        const WS = WebSocket as unknown as NativeWebSocket;
        return new WS(url, undefined, { headers: { Authorization: 'Bearer ' + s.token } });
      },
      fetchPage: () =>
        fetchPage(s).catch((err: unknown) => {
          if (err instanceof SignedOutError)
            void signedOut('This phone was signed out. Sign in again with a new code.');
          throw err;
        }),
      onChange: setState,
      onEvent: (e) => {
        hub.emit(e);
      },
      onPresence: (people) => {
        hub.setPeople(people);
      },
    });
    hub.report = (place) => {
      f.setPresence(place);
    };
    feed.current = f;
    void f.open();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void f.refresh();
    });
    return () => {
      sub.remove();
      void f.close();
      if (feed.current === f) feed.current = null;
    };
  }, [session, signedOut, hub]);

  useEffect(() => {
    hub.signedOut = () => {
      void signedOut('This phone was signed out. Sign in again with a new code.');
    };
  }, [hub, signedOut]);

  const signedIn = (s: Session): void => {
    void saveSession(s).then(() => {
      setNotice(null);
      setState(EMPTY);
      setSession(s);
    });
  };

  const signOut = (): void => {
    const s = session;
    void signedOut(null);
    if (s) void revoke(s);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        {!ready ? (
          <ActivityIndicator style={styles.fill} color={t.primary} />
        ) : session ? (
          <Main
            session={session}
            feed={state}
            hub={hub}
            onRefresh={() => feed.current?.refresh() ?? Promise.resolve()}
            onSignOut={signOut}
          />
        ) : (
          <PairScreen key={url ?? ''} link={link} notice={notice} onSignedIn={signedIn} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
