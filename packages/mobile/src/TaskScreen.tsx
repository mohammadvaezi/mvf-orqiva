// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-229 | S15 | v0.1.0] T22.2 Task detail and comments on the phone, with quick state and assignee changes ──
//    Why:  one task as a manager needs it away from the desk: where it stands and who has it, what done
//          means (the acceptance criteria and how many are ticked), the description, the conversation,
//          and what happened to it. From the phone a manager comments, moves the task to another state
//          and takes it or hands it on. A change sends only the field it changes, so it never overwrites
//          what someone else edited meanwhile. Everything reads again when an event of the task arrives.
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describe, whenText } from '@orqiva/shared';
import { call, type Session } from './client';
import { loadTask, type Comment } from './load';
import { Avatar, Bar, cardStyle, HereNow, ReadLine, ScreenHeader, SectionTitle } from './ui';
import { FONT, SPACE, useTheme, type Theme } from './theme';
import { useLive, usePeople, type EventHub } from './useLive';

type Picker = 'state' | 'assignee' | null;

export function TaskScreen(props: {
  session: Session;
  hub: EventHub;
  itemId: string;
  onBack: () => void;
}): ReactNode {
  const t = useTheme();
  const s = props.session;
  const W = '/api/workspaces/' + s.workspace.id;
  const live = useLive(() => loadTask(s, props.itemId), {
    hub: props.hub,
    scope: { kind: 'item', itemId: props.itemId },
    key: 'item.' + props.itemId,
  });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [allHistory, setAllHistory] = useState(false);
  const [longText, setLongText] = useState(false);
  const v = live.data;
  // [PCODE-230 | S15 | v0.1.0] here on this task, and who else is
  const projectId = v?.item.projectId ?? null;
  useEffect(() => {
    props.hub.here(projectId, props.itemId);
  }, [props.hub, projectId, props.itemId]);
  const here = usePeople(props.hub, s.user.id).filter((p) => p.itemId === props.itemId);
  const states = [...(v?.project.states ?? [])].sort((a, b) => a.position - b.position);
  const state = states.find((x) => x.id === v?.item.stateId);
  const people = (v?.members ?? []).filter((m) => !m.service);
  const assignee = people.find((m) => m.userId === v?.item.assigneeId);

  const act = (run: () => Promise<unknown>): void => {
    setBusy(true);
    setProblem(null);
    run()
      .then(() => live.reload())
      .catch((err: unknown) => {
        setProblem(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const patch = (body: Record<string, unknown>): void => {
    setPicker(null);
    act(() => call(s, 'PATCH', W + '/items/' + props.itemId, body));
  };
  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    act(async () => {
      await call(s, 'POST', W + '/items/' + props.itemId + '/comments', { body: text });
      setDraft('');
    });
  };

  const now = new Date();
  const done = (v?.criteria ?? []).filter((c) => c.done).length;
  const history = [...(v?.history ?? [])].reverse();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title={v ? v.item.ref : 'Task'}
        subtitle={<ReadLine readAt={live.readAt} error={live.error} />}
        onBack={props.onBack}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: SPACE[4] }}
        keyboardShouldPersistTaps="handled"
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
        ) : (
          <>
            <Text
              style={{
                color: t.text,
                fontSize: FONT.title,
                fontWeight: '700',
                paddingHorizontal: SPACE[4],
                paddingTop: SPACE[4],
              }}
            >
              {v.item.title}
            </Text>
            <Text style={{ color: t.text2, fontSize: FONT.small, paddingHorizontal: SPACE[4] }}>
              {v.project.name}
            </Text>
            {here.length ? (
              <View style={{ paddingHorizontal: SPACE[4], paddingTop: SPACE[2] }}>
                <HereNow people={here} max={4} text />
              </View>
            ) : null}
            <View style={[cardStyle(t), { marginTop: SPACE[3] }]}>
              <Fact
                label="State"
                t={t}
                onPress={() => {
                  setPicker('state');
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE[2] }}>
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: state?.color ?? t.text2,
                    }}
                  />
                  <Text style={{ color: t.text, fontSize: FONT.body }}>{state?.name ?? '—'}</Text>
                </View>
              </Fact>
              <Fact
                label="Assignee"
                t={t}
                onPress={() => {
                  setPicker('assignee');
                }}
              >
                {assignee ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE[2] }}>
                    <Avatar name={assignee.name} size={20} />
                    <Text style={{ color: t.text, fontSize: FONT.body }}>{assignee.name}</Text>
                  </View>
                ) : (
                  <Text style={{ color: t.text2, fontSize: FONT.body }}>Nobody</Text>
                )}
              </Fact>
              <Fact label="Estimate" t={t}>
                <Text style={{ color: t.text, fontSize: FONT.body }}>
                  {v.item.estimate != null ? String(v.item.estimate) + ' points' : '—'}
                </Text>
              </Fact>
              <Fact label="Priority" t={t}>
                <Text style={{ color: t.text, fontSize: FONT.body }}>
                  {v.item.priority === 'none' ? '—' : v.item.priority}
                </Text>
              </Fact>
              {v.item.dueDate ? (
                <Fact label="Due" t={t}>
                  <Text style={{ color: t.text, fontSize: FONT.body }}>
                    {new Date(v.item.dueDate).toLocaleDateString()}
                  </Text>
                </Fact>
              ) : null}
              {busy ? <ActivityIndicator color={t.primary} /> : null}
              {problem ? (
                <Text style={{ color: t.error, fontSize: FONT.small }}>{problem}</Text>
              ) : null}
            </View>

            {v.criteria.length ? (
              <>
                <SectionTitle>
                  {'Done when · ' + String(done) + ' of ' + String(v.criteria.length)}
                </SectionTitle>
                <View style={cardStyle(t)}>
                  <Bar value={done} max={v.criteria.length} color={t.success} />
                  {v.criteria.map((c) => (
                    <View key={c.id} style={{ flexDirection: 'row', gap: SPACE[2] }}>
                      <Text style={{ color: c.done ? t.success : t.text2, fontSize: FONT.body }}>
                        {c.done ? '✓' : '○'}
                      </Text>
                      <Text style={{ color: t.text, fontSize: FONT.body, flex: 1 }}>{c.text}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {v.item.description ? (
              <>
                <SectionTitle>Description</SectionTitle>
                <Pressable
                  style={cardStyle(t)}
                  onPress={() => {
                    setLongText((x) => !x);
                  }}
                >
                  <Text
                    style={{ color: t.text, fontSize: FONT.body, lineHeight: 20 }}
                    {...(longText ? {} : { numberOfLines: 6 })}
                  >
                    {v.item.description}
                  </Text>
                </Pressable>
              </>
            ) : null}

            <SectionTitle>
              {v.comments.length === 1 ? '1 comment' : String(v.comments.length) + ' comments'}
            </SectionTitle>
            {v.comments.map((c) => (
              <CommentView key={c.id} comment={c} t={t} now={now} />
            ))}

            {history.length ? (
              <>
                <SectionTitle>History</SectionTitle>
                <View style={cardStyle(t)}>
                  {(allHistory ? history : history.slice(0, 5)).map((e) => (
                    <View key={e.id} style={{ flexDirection: 'row', gap: SPACE[2] }}>
                      <Text style={{ color: t.text2, fontSize: FONT.small, width: 76 }}>
                        {whenText(e.time, now)}
                      </Text>
                      <Text style={{ color: t.text, fontSize: FONT.small, flex: 1 }}>
                        {describe(e)}
                      </Text>
                    </View>
                  ))}
                  {history.length > 5 ? (
                    <Pressable
                      onPress={() => {
                        setAllHistory((x) => !x);
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={{ color: t.primary, fontSize: FONT.small, fontWeight: '600' }}>
                        {allHistory ? 'Show less' : 'Show all ' + String(history.length)}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
      <Composer value={draft} onChange={setDraft} onSend={send} busy={busy} t={t} />
      <Modal
        visible={picker !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setPicker(null);
        }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: '#0006' }}
          onPress={() => {
            setPicker(null);
          }}
          accessibilityLabel="Close"
        />
        <PickerSheet t={t} title={picker === 'state' ? 'Move to' : 'Assign to'}>
          {picker === 'state'
            ? states.map((st) => (
                <Choice
                  key={st.id}
                  t={t}
                  label={st.name}
                  color={st.color}
                  selected={st.id === v?.item.stateId}
                  onPress={() => {
                    patch({ stateId: st.id });
                  }}
                />
              ))
            : [
                <Choice
                  key="me"
                  t={t}
                  label={'Me (' + s.user.name + ')'}
                  selected={v?.item.assigneeId === s.user.id}
                  onPress={() => {
                    patch({ assigneeId: s.user.id });
                  }}
                />,
                ...people
                  .filter((m) => m.userId !== s.user.id)
                  .map((m) => (
                    <Choice
                      key={m.userId}
                      t={t}
                      label={m.name}
                      selected={v?.item.assigneeId === m.userId}
                      onPress={() => {
                        patch({ assigneeId: m.userId });
                      }}
                    />
                  )),
                <Choice
                  key="nobody"
                  t={t}
                  label="Nobody"
                  selected={!v?.item.assigneeId}
                  onPress={() => {
                    patch({ assigneeId: null });
                  }}
                />,
              ]}
        </PickerSheet>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Fact(props: {
  label: string;
  t: Theme;
  onPress?: () => void;
  children: ReactNode;
}): ReactNode {
  const row = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 28 }}>
      <Text style={{ color: props.t.text2, fontSize: FONT.body, width: 88 }}>{props.label}</Text>
      <View style={{ flex: 1 }}>{props.children}</View>
      {props.onPress ? <Text style={{ color: props.t.text2, fontSize: FONT.title }}>›</Text> : null}
    </View>
  );
  return props.onPress ? (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={'Change ' + props.label}
    >
      {row}
    </Pressable>
  ) : (
    row
  );
}

function CommentView(props: { comment: Comment; t: Theme; now: Date }): ReactNode {
  const { comment: c, t } = props;
  const who = c.authorName ?? 'Someone';
  return (
    <View style={[cardStyle(t), { flexDirection: 'row', gap: SPACE[2] }]}>
      <Avatar name={who} size={24} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.text2, fontSize: FONT.small }}>
          {who +
            ' · ' +
            whenText(c.createdAt, props.now) +
            (c.visibility === 'client' ? ' · client sees it' : '')}
        </Text>
        <Text style={{ color: t.text, fontSize: FONT.body, lineHeight: 20 }}>{c.body}</Text>
      </View>
    </View>
  );
}

function Composer(props: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  t: Theme;
}): ReactNode {
  const { t } = props;
  const insets = useSafeAreaInsets();
  const ready = props.value.trim().length > 0 && !props.busy;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: SPACE[2],
        padding: SPACE[2],
        paddingBottom: SPACE[2] + insets.bottom,
        backgroundColor: t.surface,
        borderTopColor: t.border,
        borderTopWidth: 1,
      }}
    >
      <TextInput
        style={{
          flex: 1,
          maxHeight: 120,
          borderColor: t.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: SPACE[3],
          paddingVertical: SPACE[2],
          color: t.text,
          backgroundColor: t.surface2,
          fontSize: FONT.body,
        }}
        multiline
        value={props.value}
        onChangeText={props.onChange}
        placeholder="Write a comment"
        placeholderTextColor={t.text2}
        maxLength={20_000}
        accessibilityLabel="Comment"
      />
      <Pressable
        style={{
          backgroundColor: t.primary,
          opacity: ready ? 1 : 0.4,
          borderRadius: 8,
          paddingHorizontal: SPACE[4],
          paddingVertical: SPACE[2] + 2,
        }}
        disabled={!ready}
        onPress={props.onSend}
        accessibilityRole="button"
      >
        <Text style={{ color: t.primaryText, fontWeight: '600', fontSize: FONT.body }}>Send</Text>
      </Pressable>
    </View>
  );
}

function PickerSheet(props: { t: Theme; title: string; children: ReactNode }): ReactNode {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: props.t.surface,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingTop: SPACE[4],
        paddingBottom: insets.bottom + SPACE[2],
        maxHeight: '70%',
      }}
    >
      <Text
        style={{
          color: props.t.text,
          fontSize: FONT.title,
          fontWeight: '700',
          paddingHorizontal: SPACE[4],
          paddingBottom: SPACE[2],
        }}
      >
        {props.title}
      </Text>
      <ScrollView>{props.children}</ScrollView>
    </View>
  );
}

function Choice(props: {
  t: Theme;
  label: string;
  color?: string;
  selected: boolean;
  onPress: () => void;
}): ReactNode {
  const { t } = props;
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACE[3],
        paddingVertical: SPACE[3],
        paddingHorizontal: SPACE[4],
        backgroundColor: props.selected ? t.primaryContainer : 'transparent',
      }}
    >
      {props.color ? (
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: props.color }} />
      ) : null}
      <Text style={{ color: t.text, fontSize: FONT.body, flex: 1 }}>{props.label}</Text>
      {props.selected ? <Text style={{ color: t.primary }}>✓</Text> : null}
    </Pressable>
  );
}
