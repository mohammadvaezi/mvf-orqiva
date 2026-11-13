// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-228 | S15 | v0.1.0] T22.1 Live map on the phone: projects, health, heat, sprint progress, cards in progress, alerts ──
//    Why:  the signed-in app: two tabs (the feed, the map) and screens that stack on top of them (a
//          project with its sprint). Android's back button and the header's back go one screen back. No
//          navigation library: two tabs and a stack are a few lines.
import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FeedState } from '@orqiva/shared';
import type { Session } from './client';
import { FeedScreen } from './FeedScreen';
import { MapScreen } from './MapScreen';
import { ProjectScreen } from './ProjectScreen';
import { TaskScreen } from './TaskScreen';
import { FONT, SPACE, useTheme } from './theme';
import type { EventHub } from './useLive';

// [PCODE-229 | S15 | v0.1.0] a task, from the feed, the map or a sprint
export type Route = { kind: 'project'; id: string; title: string } | { kind: 'task'; id: string };

export function Main(props: {
  session: Session;
  feed: FeedState;
  hub: EventHub;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}): ReactNode {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'feed' | 'map'>('feed');
  const [stack, setStack] = useState<Route[]>([]);
  const push = (r: Route): void => {
    setStack((s) => [...s, r]);
  };
  const back = (): void => {
    setStack((s) => s.slice(0, -1));
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length === 0) return false;
      setStack((s) => s.slice(0, -1));
      return true;
    });
    return () => {
      sub.remove();
    };
  }, [stack.length]);

  const openItem = (id: string): void => {
    push({ kind: 'task', id });
  };
  const top = stack[stack.length - 1];
  // [PCODE-230 | S15 | v0.1.0] tell the others where this person is (a task reports itself once read)
  const where = top?.kind === 'project' ? top.id : null;
  const onTask = top?.kind === 'task';
  useEffect(() => {
    if (!onTask) props.hub.here(where, null);
  }, [props.hub, where, onTask]);
  if (top?.kind === 'task')
    return (
      <TaskScreen
        key={top.id}
        session={props.session}
        hub={props.hub}
        itemId={top.id}
        onBack={back}
      />
    );
  if (top?.kind === 'project')
    return (
      <ProjectScreen
        key={top.id}
        session={props.session}
        hub={props.hub}
        projectId={top.id}
        title={top.title}
        onBack={back}
        onItem={openItem}
      />
    );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {tab === 'feed' ? (
          <FeedScreen
            session={props.session}
            feed={props.feed}
            onRefresh={props.onRefresh}
            onSignOut={props.onSignOut}
            onItem={openItem}
          />
        ) : (
          <MapScreen
            session={props.session}
            hub={props.hub}
            onProject={(p) => {
              push({ kind: 'project', id: p.id, title: p.name });
            }}
            onItem={openItem}
          />
        )}
      </View>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: t.surface,
          borderTopColor: t.border,
          borderTopWidth: 1,
          paddingBottom: insets.bottom,
        }}
        accessibilityRole="tablist"
      >
        {(['feed', 'map'] as const).map((k) => (
          <Pressable
            key={k}
            style={{ flex: 1, alignItems: 'center', paddingVertical: SPACE[3] }}
            onPress={() => {
              setTab(k);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
          >
            <Text
              style={{
                fontSize: FONT.body,
                fontWeight: tab === k ? '700' : '500',
                color: tab === k ? t.primary : t.text2,
              }}
            >
              {k === 'feed' ? 'Feed' : 'Map'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
