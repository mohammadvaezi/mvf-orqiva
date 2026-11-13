// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  the phone's sign-in. The person scans the QR code from the web app (Settings → Phone app) or
//          types the server and the eight characters. A scanned code or an opened link always asks first,
//          naming the server: any web page can open an orqiva:// link, and a phone must never sign in to
//          a server its owner did not choose. Plain HTTP outside the local network is called out.
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  normalizePairingCode,
  normalizeServer,
  pairingCodeText,
  parsePairingLink,
} from '@orqiva/shared';
import { insecureServer, pair, type Session } from './client';
import { FONT, SPACE, useTheme, type Theme } from './theme';

const defaultDevice = (): string =>
  (Device.deviceName ?? Device.modelName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android phone'))
    .trim()
    .slice(0, 60) || 'Phone';

export function PairScreen(props: {
  /** a pairing link the app was opened with */
  link?: { server: string; code: string } | null;
  /** why the phone is here again, e.g. it was signed out elsewhere */
  notice?: string | null;
  onSignedIn: (s: Session) => void;
}): ReactNode {
  const t = useTheme();
  const st = styles(t);
  const [server, setServer] = useState('');
  const [code, setCode] = useState('');
  const [device, setDevice] = useState(defaultDevice);
  const [confirm, setConfirm] = useState<{ server: string; code: string } | null>(
    props.link ?? null,
  );
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [permission, requestPermission] = useCameraPermissions();

  const signIn = (target: { server: string; code: string }): void => {
    setBusy(true);
    setError('');
    pair(target.server, target.code, device.trim() || 'Phone')
      .then(props.onSignedIn)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      });
  };

  const typed = (): void => {
    const s = normalizeServer(server);
    const c = normalizePairingCode(code);
    if (!s) setError('Type the server’s address, e.g. orqiva.example.com');
    else if (!c) setError('The code has 8 letters and digits, e.g. AB3K-7MQX');
    else signIn({ server: s, code: c });
  };

  const scan = (): void => {
    setError('');
    if (permission?.granted) {
      setScanning(true);
      return;
    }
    void requestPermission().then((p) => {
      if (p.granted) setScanning(true);
      else setError('Without the camera, type the server and the code below.');
    });
  };

  if (scanning)
    return (
      <View style={st.scanner}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(r) => {
            const link = parsePairingLink(r.data);
            if (!link) return; // another QR code: keep looking
            setScanning(false);
            setConfirm(link);
          }}
        />
        <View style={st.scanFrame} pointerEvents="none" />
        <Text style={st.scanHint}>Point the camera at the code in Settings → Phone app</Text>
        <Pressable
          style={[st.button, st.buttonSecondary, st.scanCancel]}
          onPress={() => {
            setScanning(false);
          }}
          accessibilityRole="button"
        >
          <Text style={st.buttonSecondaryText}>Cancel</Text>
        </Pressable>
      </View>
    );

  if (confirm) {
    const host = confirm.server.replace(/^https?:\/\//, '');
    return (
      <ScrollView contentContainerStyle={st.page}>
        <Text style={st.brand}>Orqiva</Text>
        <View style={st.card}>
          <Text style={st.title}>Sign in to this server?</Text>
          <Text style={st.server}>{host}</Text>
          <Text style={st.muted}>Code {pairingCodeText(confirm.code)}</Text>
          {insecureServer(confirm.server) ? (
            <Text style={st.warn}>
              This server does not use HTTPS. Only continue on a network you trust.
            </Text>
          ) : null}
          <Text style={st.label}>This phone’s name</Text>
          <TextInput
            style={st.input}
            value={device}
            onChangeText={setDevice}
            maxLength={60}
            accessibilityLabel="This phone’s name"
          />
          {error ? <Text style={st.error}>{error}</Text> : null}
          <Pressable
            style={[st.button, busy && st.disabled]}
            disabled={busy}
            onPress={() => {
              signIn(confirm);
            }}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={t.primaryText} />
            ) : (
              <Text style={st.buttonText}>Sign in</Text>
            )}
          </Pressable>
          <Pressable
            style={[st.button, st.buttonSecondary]}
            onPress={() => {
              setConfirm(null);
              setError('');
              setBusy(false);
            }}
            accessibilityRole="button"
          >
            <Text style={st.buttonSecondaryText}>Not this server</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={st.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={st.page} keyboardShouldPersistTaps="handled">
        <Text style={st.brand}>Orqiva</Text>
        <Text style={st.lead}>
          The live feed of your workspace, on the phone. Sign in with a code from the web app:
          Settings → Phone app.
        </Text>
        {props.notice ? <Text style={st.notice}>{props.notice}</Text> : null}
        {Platform.OS !== 'web' ? (
          <Pressable style={st.button} onPress={scan} accessibilityRole="button">
            <Text style={st.buttonText}>Scan the code</Text>
          </Pressable>
        ) : null}
        <View style={st.card}>
          <Text style={st.cardTitle}>Or type it</Text>
          <Text style={st.label}>Server</Text>
          <TextInput
            style={st.input}
            value={server}
            onChangeText={setServer}
            placeholder="orqiva.example.com"
            placeholderTextColor={t.text2}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Server"
          />
          <Text style={st.label}>Code</Text>
          <TextInput
            style={[st.input, st.codeInput]}
            value={code}
            onChangeText={(v) => {
              setCode(v.toUpperCase());
            }}
            placeholder="AB3K-7MQX"
            placeholderTextColor={t.text2}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            accessibilityLabel="Code"
          />
          <Text style={st.label}>This phone’s name</Text>
          <TextInput
            style={st.input}
            value={device}
            onChangeText={setDevice}
            maxLength={60}
            accessibilityLabel="This phone’s name"
          />
          {error ? <Text style={st.error}>{error}</Text> : null}
          <Pressable
            style={[st.button, (busy || !server || !code) && st.disabled]}
            disabled={busy || !server || !code}
            onPress={typed}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={t.primaryText} />
            ) : (
              <Text style={st.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </View>
        <Text style={st.footnote}>
          The app never asks for your password. A code works once, for 10 minutes.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    fill: { flex: 1 },
    page: {
      flexGrow: 1,
      padding: SPACE[4],
      paddingTop: SPACE[6] * 2,
      gap: SPACE[3],
      maxWidth: 520,
      width: '100%',
      alignSelf: 'center',
    },
    brand: { fontSize: FONT.large, fontWeight: '700', color: t.primary },
    lead: { fontSize: FONT.body, color: t.text, lineHeight: 20 },
    notice: {
      fontSize: FONT.body,
      color: t.error,
      backgroundColor: t.errorBg,
      padding: SPACE[3],
      borderRadius: 8,
    },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: SPACE[4],
      gap: SPACE[2],
    },
    cardTitle: { fontSize: FONT.body, fontWeight: '600', color: t.text },
    title: { fontSize: FONT.title, fontWeight: '600', color: t.text },
    server: {
      fontSize: FONT.title,
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
      color: t.text,
    },
    muted: { fontSize: FONT.body, color: t.text2 },
    label: { fontSize: FONT.small, color: t.text2, marginTop: SPACE[1] },
    input: {
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: SPACE[3],
      paddingVertical: SPACE[2],
      fontSize: FONT.body,
      color: t.text,
      backgroundColor: t.surface2,
    },
    codeInput: {
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
      letterSpacing: 2,
      fontSize: FONT.title,
    },
    warn: { fontSize: FONT.body, color: t.warn },
    error: { fontSize: FONT.body, color: t.error },
    button: {
      backgroundColor: t.primary,
      borderRadius: 8,
      paddingVertical: SPACE[3],
      alignItems: 'center',
      marginTop: SPACE[2],
    },
    buttonText: { color: t.primaryText, fontSize: FONT.body, fontWeight: '600' },
    buttonSecondary: { backgroundColor: 'transparent', borderColor: t.border, borderWidth: 1 },
    buttonSecondaryText: { color: t.text, fontSize: FONT.body, fontWeight: '600' },
    disabled: { opacity: 0.5 },
    footnote: { fontSize: FONT.small, color: t.text2, textAlign: 'center' },
    scanner: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
    scanFrame: {
      width: 240,
      height: 240,
      borderColor: '#fff',
      borderWidth: 2,
      borderRadius: 16,
    },
    scanHint: {
      color: '#fff',
      fontSize: FONT.body,
      marginTop: SPACE[4],
      textAlign: 'center',
      paddingHorizontal: SPACE[6],
    },
    scanCancel: { position: 'absolute', bottom: SPACE[6] * 2, left: SPACE[6], right: SPACE[6] },
  });
