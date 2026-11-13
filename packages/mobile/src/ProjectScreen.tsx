// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-228 | S15 | v0.1.0] T22.1 Live map on the phone: projects, health, heat, sprint progress, cards in progress, alerts ──
//    Why:  a project from the phone is its running sprint: which day it is, how many points are done of
//          those committed (with today's mark, so behind shows at a glance), the goal, and every task
//          grouped by state with who has it. It reads again when an event of the project arrives.
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { Session } from './client';
import { loadProject } from './load';
import { sprintDay } from './scope';
import type { Item, State } from './types';
import type { PresenceEntry } from '@orqiva/shared';
import { Avatar, Bar, cardStyle, HereNow, ReadLine, ScreenHeader, SectionTitle } from './ui';
import { FONT, SPACE, useTheme } from './theme';
import { useLive, usePeople, type EventHub } from './useLive';

export function ProjectScreen(props: {
  session: Session;
  hub: EventHub;
  projectId: string;
  title: string;
  onBack: () => void;
  /** opens a task (from T22.2) */
  onItem?: (itemId: string) => void;
}): ReactNode {
  const t = useTheme();
  const live = useLive(() => loadProject(props.session, props.projectId), {
    hub: props.hub,
    scope: { kind: 'project', projectId: props.projectId },
    key: 'project.' + props.projectId,
  });
  const v = live.data;
  // [PCODE-230 | S15 | v0.1.0] who else is in this project, and on which task
  const here = usePeople(props.hub, props.session.user.id).filter(
    (p) => p.projectId === props.projectId,
  );
  const sprint = v?.sprint ?? null;
  const day = sprint ? sprintDay(sprint.startDate, sprint.endDate, new Date()) : null;
  const names = new Map((v?.members ?? []).map((m) => [m.userId, m.name]));
  const states = [...(v?.project.states ?? [])].sort((a, b) => a.position - b.position);
  const groups = states
    .map((st) => ({ state: st, items: (v?.items ?? []).filter((i) => i.stateId === st.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        title={v?.project.name ?? props.title}
        subtitle={<ReadLine readAt={live.readAt} error={live.error} />}
        onBack={props.onBack}
        right={<HereNow people={here} />}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: SPACE[6] }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            tintColor={t.primary}
            onRefresh={() => void live.reload()}
          />
        }
      >
        {!v ? (
          <Text style={{ color: t.text2, padding: SPACE[4] }}>{live.error ?? 'Reading…'}</Text>
        ) : !sprint ? (
          <View style={[cardStyle(t), { marginTop: SPACE[4] }]}>
            <Text style={{ color: t.text, fontWeight: '600', fontSize: FONT.body }}>
              No sprint is running
            </Text>
            <Text style={{ color: t.text2, fontSize: FONT.small }}>
              {v.next ? 'Next: ' + v.next.name : 'No sprint is planned either.'}
            </Text>
          </View>
        ) : (
          <>
            <SectionTitle>Sprint</SectionTitle>
            <View style={cardStyle(t)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: t.text, fontWeight: '700', fontSize: FONT.body }}>
                  {sprint.name}
                </Text>
                {day ? (
                  <Text style={{ color: t.text2, fontSize: FONT.small }}>
                    {'Day ' + String(day.day) + ' of ' + String(day.days)}
                  </Text>
                ) : null}
              </View>
              {sprint.goal ? (
                <Text style={{ color: t.text, fontSize: FONT.small }}>{sprint.goal}</Text>
              ) : null}
              <Bar
                value={sprint.estimateDone}
                max={sprint.estimateTotal}
                {...(day ? { marker: day.share } : {})}
                color={
                  day &&
                  sprint.estimateTotal > 0 &&
                  day.share - sprint.estimateDone / sprint.estimateTotal > 0.2
                    ? t.warn
                    : t.primary
                }
              />
              <Text style={{ color: t.text2, fontSize: FONT.small }}>
                {String(sprint.estimateDone) +
                  ' of ' +
                  String(sprint.estimateTotal) +
                  ' points · ' +
                  String(sprint.doneCount) +
                  ' of ' +
                  String(sprint.itemCount) +
                  ' tasks done' +
                  (sprint.addedCount
                    ? ' · ' + String(sprint.addedCount) + ' added after the start'
                    : '') +
                  (v.capacity?.velocity != null
                    ? ' · velocity ' + String(v.capacity.velocity)
                    : '')}
              </Text>
            </View>
            {groups.map((g) => (
              <StateGroup
                key={g.state.id}
                state={g.state}
                items={g.items}
                names={names}
                here={here}
                {...(props.onItem ? { onItem: props.onItem } : {})}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StateGroup(props: {
  state: State;
  items: Item[];
  names: Map<string, string>;
  here: PresenceEntry[];
  onItem?: (id: string) => void;
}): ReactNode {
  const t = useTheme();
  return (
    <>
      <SectionTitle>{props.state.name + ' · ' + String(props.items.length)}</SectionTitle>
      <View style={{ backgroundColor: t.surface, borderTopColor: t.border, borderTopWidth: 1 }}>
        {props.items.map((i) => {
          const who = i.assigneeId ? props.names.get(i.assigneeId) : undefined;
          return (
            <Pressable
              key={i.id}
              onPress={() => {
                props.onItem?.(i.id);
              }}
              accessibilityRole="button"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACE[2],
                paddingVertical: SPACE[2],
                paddingHorizontal: SPACE[4],
                borderBottomColor: t.border,
                borderBottomWidth: 1,
              }}
            >
              <View
                style={{
                  width: 4,
                  alignSelf: 'stretch',
                  borderRadius: 2,
                  backgroundColor: props.state.color,
                }}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: FONT.body }} numberOfLines={2}>
                  {i.title}
                </Text>
                <Text style={{ color: t.text2, fontSize: FONT.small }}>
                  {i.ref +
                    (i.estimate != null ? ' · ' + String(i.estimate) + ' pt' : '') +
                    (i.commentCount
                      ? ' · ' +
                        String(i.commentCount) +
                        (i.commentCount === 1 ? ' comment' : ' comments')
                      : '')}
                </Text>
              </View>
              <HereNow people={props.here.filter((p) => p.itemId === i.id)} max={2} />
              {who ? <Avatar name={who} size={22} /> : null}
            </Pressable>
          );
        })}
      </View>
    </>
  );
}
