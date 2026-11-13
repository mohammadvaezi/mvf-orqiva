// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-228 | S15 | v0.1.0] T22.1 Live map on the phone: projects, health, heat, sprint progress, cards in progress, alerts ──
//    Why:  the few pieces every screen uses, in the web app's dense style: a screen header with back,
//          avatars for people and agents, a progress bar, the health pill, the "read at" line that says
//          how fresh the screen is, and section titles.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HEALTH_TEXT, type Health, type PresenceEntry } from '@orqiva/shared';
import { initials } from './rows';
import { readAt } from './scope';
import { FONT, SPACE, useTheme, type Theme } from './theme';

export function ScreenHeader(props: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
}): ReactNode {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + SPACE[2],
        paddingBottom: SPACE[3],
        paddingHorizontal: SPACE[4],
        backgroundColor: t.surface,
        borderBottomColor: t.border,
        borderBottomWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACE[3],
      }}
    >
      {props.onBack ? (
        <Pressable
          onPress={props.onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={{ paddingRight: SPACE[1] }}
        >
          <Text style={{ color: t.primary, fontSize: 30, lineHeight: 30, fontWeight: '400' }}>
            ‹
          </Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{ fontSize: FONT.title, fontWeight: '700', color: t.text }}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {props.title}
        </Text>
        {typeof props.subtitle === 'string' ? (
          <Text style={{ fontSize: FONT.small, color: t.text2 }} numberOfLines={1}>
            {props.subtitle}
          </Text>
        ) : (
          props.subtitle
        )}
      </View>
      {props.right}
    </View>
  );
}

export function Avatar(props: {
  name: string;
  agent?: boolean;
  size?: number;
  /** [PCODE-230 | S15 | v0.1.0] here right now: a ring */
  here?: boolean;
}): ReactNode {
  const t = useTheme();
  const size = props.size ?? 24;
  const tone = props.agent ? t.tones.agent : t.tones.work;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: props.agent ? 6 : size / 2,
        backgroundColor: tone + (t.dark ? '33' : '1f'),
        alignItems: 'center',
        justifyContent: 'center',
        ...(props.here ? { borderWidth: 2, borderColor: t.success } : {}),
      }}
      accessibilityLabel={props.name}
    >
      <Text style={{ color: tone, fontSize: Math.round(size * 0.4), fontWeight: '700' }}>
        {initials(props.name)}
      </Text>
    </View>
  );
}

const pct = (share: number): `${number}%` => `${Math.round(share * 100)}%`;

export function Bar(props: {
  value: number;
  max: number;
  color?: string;
  marker?: number;
}): ReactNode {
  const t = useTheme();
  const share = props.max > 0 ? Math.min(1, props.value / props.max) : 0;
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface2, overflow: 'hidden' }}>
      <View
        style={{
          width: pct(share),
          height: 6,
          backgroundColor: props.color ?? t.primary,
        }}
      />
      {props.marker !== undefined ? (
        <View
          style={{
            position: 'absolute',
            left: pct(Math.min(1, props.marker)),
            top: 0,
            bottom: 0,
            width: 2,
            backgroundColor: t.text2,
          }}
        />
      ) : null}
    </View>
  );
}

export const healthColor = (t: Theme, h: string): string =>
  h === 'critical' ? t.error : h === 'at-risk' ? t.warn : t.success;

export function HealthPill(props: { health: string }): ReactNode {
  const t = useTheme();
  const c = healthColor(t, props.health);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: SPACE[2],
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: c + (t.dark ? '26' : '1a'),
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
      <Text style={{ color: c, fontSize: FONT.small, fontWeight: '600' }}>
        {HEALTH_TEXT[props.health as Health] ?? props.health}
      </Text>
    </View>
  );
}

/** "Read at 10:42", or the error that kept it from reading again. */
export function ReadLine(props: { readAt: string | null; error: string | null }): ReactNode {
  const t = useTheme();
  const when = readAt(props.readAt, new Date());
  const text = props.error
    ? (when ? 'Showing what was read at ' + when + '. ' : '') + props.error
    : when
      ? 'Read at ' + when + ', updates live'
      : 'Reading…';
  return (
    <Text style={{ fontSize: FONT.small, color: props.error ? t.warn : t.text2 }}>{text}</Text>
  );
}

export function SectionTitle(props: { children: ReactNode }): ReactNode {
  const t = useTheme();
  return (
    <Text
      style={{
        fontSize: FONT.small,
        fontWeight: '600',
        color: t.text2,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        paddingHorizontal: SPACE[4],
        paddingTop: SPACE[4],
        paddingBottom: SPACE[2],
      }}
      accessibilityRole="header"
    >
      {props.children}
    </Text>
  );
}

export const cardStyle = (t: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      marginHorizontal: SPACE[4],
      marginBottom: SPACE[3],
      padding: SPACE[3],
      gap: SPACE[2],
    },
  }).card;

/** [PCODE-230 | S15 | v0.1.0] "Bob is viewing on the phone, Eve is editing": the people here right now. */
export const hereText = (people: PresenceEntry[]): string =>
  people
    .map(
      (p) =>
        p.name +
        (p.state === 'editing' ? ' is editing' : ' is viewing') +
        (p.device === 'phone' ? ' on the phone' : ''),
    )
    .join(', ');

export function HereNow(props: {
  people: PresenceEntry[];
  max?: number;
  text?: boolean;
}): ReactNode {
  const t = useTheme();
  if (!props.people.length) return null;
  const shown = props.people.slice(0, props.max ?? 3);
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE[1] }}
      accessibilityLabel={hereText(props.people)}
    >
      {shown.map((p) => (
        <Avatar key={p.userId} name={p.name} agent={p.kind === 'agent'} size={20} here />
      ))}
      {props.people.length > shown.length ? (
        <Text style={{ color: t.text2, fontSize: FONT.small }}>
          {'+' + String(props.people.length - shown.length)}
        </Text>
      ) : null}
      {props.text ? (
        <Text style={{ color: t.text2, fontSize: FONT.small, flex: 1 }} numberOfLines={2}>
          {hereText(props.people)}
        </Text>
      ) : null}
    </View>
  );
}
