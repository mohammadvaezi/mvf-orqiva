// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  the workspace's live feed: what happens, as it happens, in the sentences the web app uses,
//          grouped by day. The header says whether the phone is live; offline, a banner says what is shown
//          and from when. Pull to refresh asks the server again and reconnects at once. The account sheet
//          shows who is signed in where, and signs the phone out.
import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FeedState } from '@orqiva/shared';
import type { Session } from './client';
import { feedRows, initials, type Row } from './rows';
import { FONT, SPACE, useTheme, type Theme } from './theme';

const clock = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

const STATUS_TEXT = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' } as const;

export function FeedScreen(props: {
  session: Session;
  feed: FeedState;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
  /** [PCODE-229 | S15 | v0.1.0] opens the task an event is about */
  onItem?: (itemId: string) => void;
}): ReactNode {
  const t = useTheme();
  const st = styles(t);
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [account, setAccount] = useState(false);
  const rows = useMemo(() => feedRows(props.feed.events, new Date()), [props.feed.events]);
  const { status, cachedAt } = props.feed;
  const dot = status === 'live' ? t.success : status === 'connecting' ? t.warn : t.text2;

  const banner =
    status === 'offline'
      ? 'Offline. ' +
        (cachedAt
          ? 'Showing what was saved at ' + clock(cachedAt) + '.'
          : 'Showing what arrived before.') +
        ' New events follow when the network is back.'
      : null;

  return (
    <View style={[st.fill, { paddingTop: insets.top }]}>
      <View style={st.header}>
        <View style={st.headerText}>
          <Text style={st.workspace} numberOfLines={1}>
            {props.session.workspace.name}
          </Text>
          <View style={st.status} accessibilityRole="text" accessibilityLabel={STATUS_TEXT[status]}>
            <View style={[st.dot, { backgroundColor: dot }]} />
            <Text style={st.statusText}>{STATUS_TEXT[status]}</Text>
          </View>
        </View>
        <Pressable
          style={st.me}
          onPress={() => {
            setAccount(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Account"
        >
          <Text style={st.meText}>{initials(props.session.user.name)}</Text>
        </Pressable>
      </View>
      {banner ? <Text style={st.banner}>{banner}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) => (
          <FeedRow row={item} t={t} {...(props.onItem ? { onItem: props.onItem } : {})} />
        )}
        contentContainerStyle={[st.list, { paddingBottom: insets.bottom + SPACE[6] }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={t.primary}
            onRefresh={() => {
              setRefreshing(true);
              void props.onRefresh().finally(() => {
                setRefreshing(false);
              });
            }}
          />
        }
        ListEmptyComponent={
          <View style={st.empty}>
            <Text style={st.emptyTitle}>
              {status === 'connecting' ? 'Loading…' : 'Nothing has happened here yet'}
            </Text>
            <Text style={st.emptyText}>
              Changes to tasks, sprints, agents, deploys and tests show up here the moment they
              happen.
            </Text>
          </View>
        }
      />
      <Modal
        visible={account}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setAccount(false);
        }}
      >
        <Pressable
          style={st.scrim}
          onPress={() => {
            setAccount(false);
          }}
          accessibilityLabel="Close"
        />
        <View style={[st.sheet, { paddingBottom: insets.bottom + SPACE[4] }]}>
          <Text style={st.sheetTitle}>{props.session.user.name}</Text>
          <Text style={st.sheetMuted}>{props.session.user.email}</Text>
          <View style={st.facts}>
            <Fact label="Workspace" value={props.session.workspace.name} t={t} />
            <Fact label="Server" value={props.session.server.replace(/^https?:\/\//, '')} t={t} />
            <Fact
              label="Signed in until"
              value={
                props.session.expiresAt
                  ? new Date(props.session.expiresAt).toLocaleDateString()
                  : 'no end set'
              }
              t={t}
            />
          </View>
          <Text style={st.sheetMuted}>
            The web app lists this phone under Settings → Phone app, where it can be signed out too.
          </Text>
          <Pressable
            style={st.signOut}
            onPress={() => {
              setAccount(false);
              props.onSignOut();
            }}
            accessibilityRole="button"
          >
            <Text style={st.signOutText}>Sign out of this phone</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

function Fact(props: { label: string; value: string; t: Theme }): ReactNode {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SPACE[3] }}>
      <Text style={{ color: props.t.text2, fontSize: FONT.body }}>{props.label}</Text>
      <Text style={{ color: props.t.text, fontSize: FONT.body, flexShrink: 1 }} numberOfLines={1}>
        {props.value}
      </Text>
    </View>
  );
}

function FeedRow(props: { row: Row; t: Theme; onItem?: (itemId: string) => void }): ReactNode {
  const { row, t } = props;
  if (row.kind === 'day')
    return (
      <Text
        style={{
          fontSize: FONT.small,
          fontWeight: '600',
          color: t.text2,
          paddingTop: SPACE[4],
          paddingBottom: SPACE[1],
          paddingHorizontal: SPACE[4],
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
        accessibilityRole="header"
      >
        {row.label}
      </Text>
    );
  const tone = t.tones[row.tone];
  const open = row.itemId && props.onItem ? row.itemId : null;
  return (
    <Pressable
      disabled={!open}
      onPress={() => {
        if (open) props.onItem?.(open);
      }}
      accessibilityRole={open ? 'button' : 'text'}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: SPACE[3],
        paddingVertical: SPACE[2],
        paddingHorizontal: SPACE[4],
        backgroundColor: t.surface,
        borderBottomColor: t.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: row.agent ? 6 : 14,
          backgroundColor: tone + (t.dark ? '33' : '1f'),
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Text style={{ color: tone, fontSize: 11, fontWeight: '700' }}>{row.initials}</Text>
      </View>
      <Text style={{ flex: 1, color: t.text, fontSize: FONT.body, lineHeight: 19 }}>
        {row.text}
      </Text>
      <Text style={{ color: t.text2, fontSize: FONT.small, marginTop: 2 }}>{row.time}</Text>
    </Pressable>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    fill: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACE[4],
      paddingVertical: SPACE[3],
      backgroundColor: t.surface,
      borderBottomColor: t.border,
      borderBottomWidth: 1,
    },
    headerText: { flex: 1, gap: 2 },
    workspace: { fontSize: FONT.title, fontWeight: '700', color: t.text },
    status: { flexDirection: 'row', alignItems: 'center', gap: SPACE[1] },
    dot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { fontSize: FONT.small, color: t.text2 },
    me: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: t.primaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    meText: { color: t.primary, fontWeight: '700', fontSize: FONT.small },
    banner: {
      backgroundColor: t.surface2,
      color: t.text,
      fontSize: FONT.small,
      paddingHorizontal: SPACE[4],
      paddingVertical: SPACE[2],
      borderBottomColor: t.border,
      borderBottomWidth: 1,
    },
    list: { flexGrow: 1 },
    empty: { padding: SPACE[6], gap: SPACE[2], alignItems: 'center' },
    emptyTitle: { fontSize: FONT.body, fontWeight: '600', color: t.text },
    emptyText: { fontSize: FONT.body, color: t.text2, textAlign: 'center' },
    scrim: { flex: 1, backgroundColor: '#0006' },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: SPACE[4],
      gap: SPACE[2],
    },
    sheetTitle: { fontSize: FONT.title, fontWeight: '700', color: t.text },
    sheetMuted: { fontSize: FONT.small, color: t.text2 },
    facts: {
      gap: SPACE[2],
      paddingVertical: SPACE[3],
      borderTopColor: t.border,
      borderTopWidth: 1,
      borderBottomColor: t.border,
      borderBottomWidth: 1,
      marginVertical: SPACE[2],
    },
    signOut: {
      borderColor: t.error,
      borderWidth: 1,
      borderRadius: 8,
      paddingVertical: SPACE[3],
      alignItems: 'center',
      marginTop: SPACE[2],
    },
    signOutText: { color: t.error, fontWeight: '600', fontSize: FONT.body },
  });
