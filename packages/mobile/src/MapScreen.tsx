// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-228 | S15 | v0.1.0] T22.1 Live map on the phone: projects, health, heat, sprint progress, cards in progress, alerts ──
//    Why:  the command center sized for a phone: the open alerts first, then one card per project with
//          its health and the reasons, the five risks as a strip, the counts, and the tasks in progress
//          with the person and the agents on them. It reads the command center's own data and reads it
//          again when an event touches the map.
import type { ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { HEAT_KEYS, HEAT_LABELS } from '@orqiva/shared';
import { call, type Session } from './client';
import type { Alert, CommandCenter, MapProject } from './types';
import type { PresenceEntry } from '@orqiva/shared';
import { Avatar, cardStyle, HealthPill, HereNow, ReadLine, ScreenHeader, SectionTitle } from './ui';
import { FONT, SPACE, useTheme, type Theme } from './theme';
import { useLive, usePeople, type EventHub } from './useLive';

const SEVERITY = { sev1: 'SEV 1', sev2: 'SEV 2', sev3: 'SEV 3', sev4: 'SEV 4' } as const;

const heatColor = (t: Theme, level: string): string =>
  level === 'bad' ? t.error : level === 'warn' ? t.warn : level === 'ok' ? t.success : t.border;

export function MapScreen(props: {
  session: Session;
  hub: EventHub;
  onProject: (p: MapProject) => void;
  /** opens a task (from T22.2) */
  onItem?: (itemId: string) => void;
}): ReactNode {
  const t = useTheme();
  const s = props.session;
  const live = useLive(
    () => call<CommandCenter>(s, 'GET', '/api/workspaces/' + s.workspace.id + '/command-center'),
    { hub: props.hub, scope: { kind: 'map' }, key: 'map.' + s.workspace.id, cache: true },
  );
  const cc = live.data;
  const order = { critical: 0, 'at-risk': 1, 'on-track': 2 } as Record<string, number>;
  const projects = [...(cc?.projects ?? [])].sort(
    (a, b) => (order[a.health] ?? 3) - (order[b.health] ?? 3) || a.name.localeCompare(b.name),
  );
  const alerts = cc?.alerts ?? [];
  const people = usePeople(props.hub, s.user.id); // [PCODE-230 | S15 | v0.1.0]

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Map" subtitle={<ReadLine readAt={live.readAt} error={live.error} />} />
      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl
            refreshing={false}
            tintColor={t.primary}
            onRefresh={() => void live.reload()}
          />
        }
        ListHeaderComponent={
          <>
            {alerts.length ? (
              <>
                <SectionTitle>Open alerts</SectionTitle>
                {alerts.slice(0, 5).map((a) => (
                  <AlertRow key={a.id} alert={a} t={t} />
                ))}
              </>
            ) : null}
            <SectionTitle>
              {projects.length === 1 ? '1 project' : String(projects.length) + ' projects'}
            </SectionTitle>
          </>
        }
        renderItem={({ item }) => (
          <ProjectCard
            project={item}
            here={people.filter((p) => p.projectId === item.id)}
            t={t}
            onOpen={props.onProject}
            {...(props.onItem ? { onItem: props.onItem } : {})}
          />
        )}
        ListEmptyComponent={
          <Text style={{ color: t.text2, padding: SPACE[4], textAlign: 'center' }}>
            {live.loading ? 'Reading the map…' : 'No projects you can see yet.'}
          </Text>
        }
        contentContainerStyle={{ paddingBottom: SPACE[6] }}
      />
    </View>
  );
}

function AlertRow(props: { alert: Alert; t: Theme }): ReactNode {
  const { alert: a, t } = props;
  const serious = a.severity === 'sev1' || a.severity === 'sev2';
  return (
    <View
      style={{
        marginHorizontal: SPACE[4],
        marginBottom: SPACE[2],
        padding: SPACE[3],
        borderRadius: 8,
        backgroundColor: serious ? t.errorBg : t.surface,
        borderColor: serious ? t.error : t.border,
        borderWidth: 1,
        gap: 2,
      }}
    >
      <Text style={{ color: serious ? t.error : t.warn, fontSize: FONT.small, fontWeight: '700' }}>
        {(SEVERITY[a.severity as keyof typeof SEVERITY] ?? a.severity) +
          (a.projectKey ? ' · ' + a.projectKey : '') +
          (a.count > 1 ? ' · ' + String(a.count) + '×' : '')}
      </Text>
      <Text style={{ color: t.text, fontSize: FONT.body }}>{a.title}</Text>
    </View>
  );
}

function ProjectCard(props: {
  project: MapProject;
  here: PresenceEntry[];
  t: Theme;
  onOpen: (p: MapProject) => void;
  onItem?: (itemId: string) => void;
}): ReactNode {
  const { project: p, t } = props;
  return (
    <Pressable
      style={cardStyle(t)}
      onPress={() => {
        props.onOpen(p);
      }}
      accessibilityRole="button"
      accessibilityLabel={p.name + ', ' + p.health}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE[2] }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: FONT.body, fontWeight: '700' }} numberOfLines={1}>
            {p.name}
          </Text>
          <Text style={{ color: t.text2, fontSize: FONT.small }} numberOfLines={1}>
            {[p.key, p.client, p.phase].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <HereNow people={props.here} />
        <HealthPill health={p.health} />
      </View>
      {p.reasons.length ? (
        <Text style={{ color: t.text, fontSize: FONT.small }} numberOfLines={2}>
          {p.reasons.slice(0, 2).join(' · ')}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {HEAT_KEYS.map((k) => (
          <View
            key={k}
            style={{ flex: 1, gap: 2 }}
            accessibilityLabel={HEAT_LABELS[k] + ': ' + p.heat[k].level}
          >
            <View
              style={{ height: 4, borderRadius: 2, backgroundColor: heatColor(t, p.heat[k].level) }}
            />
            <Text style={{ color: t.text2, fontSize: 10 }} numberOfLines={1}>
              {HEAT_LABELS[k]}
            </Text>
          </View>
        ))}
      </View>
      <Text style={{ color: t.text2, fontSize: FONT.small }}>
        {String(p.counts.inProgress) +
          ' in progress · ' +
          String(p.counts.open) +
          ' open · ' +
          String(p.counts.doneThisWeek) +
          ' done this week'}
      </Text>
      {p.cards.slice(0, 3).map((c) => (
        <Pressable
          key={c.id}
          onPress={() => {
            props.onItem?.(c.id);
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACE[2],
            paddingTop: SPACE[2],
            borderTopColor: t.border,
            borderTopWidth: 1,
          }}
          accessibilityRole="button"
        >
          <Text style={{ color: t.text2, fontSize: FONT.small, width: 56 }} numberOfLines={1}>
            {c.ref}
          </Text>
          <Text style={{ color: t.text, fontSize: FONT.small, flex: 1 }} numberOfLines={1}>
            {c.title}
          </Text>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {c.assignee ? <Avatar name={c.assignee.name} size={20} /> : null}
            {c.agents.map((a) => (
              <Avatar key={a.name} name={a.name} agent size={20} />
            ))}
          </View>
        </Pressable>
      ))}
      {p.cards.length > 3 ? (
        <Text style={{ color: t.text2, fontSize: FONT.small }}>
          {'and ' + String(p.cards.length - 3) + ' more in progress'}
        </Text>
      ) : null}
    </Pressable>
  );
}
