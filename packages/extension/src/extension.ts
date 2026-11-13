// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-458 | S15 | v0.1.0] VS Code extension updates itself from GitHub: CI publishes the build, Update button installs it ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-311 | S15 | v0.1.0] T31.9b Code review in VS Code: the queue, the diff and line comments ──
// ── [PCODE-236 | S15 | v0.1.0] T23.3 Messages for clients, in VS Code and in the CLI ──
// ── [PCODE-207 | S15 | v0.1.0] T17.5 Releases from the terminal and VS Code: orq release, orq env, orq train ──
// ── [PCODE-201 | S15 | v0.1.0] T16.5 Docs and handover from the terminal and VS Code: orq docs scan/build/drift, orq handover ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-194 | S15 | v0.1.0] B8.2 VS Code: agents view and runs, findings as problems, code-map lens, test results per criterion ──
// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-1 | S01 | v0.1.0] Scaffold the extension repo: manifest, esbuild bundle, tsconfig, lint and format ──
// ── [PCODE-2 | S01 | v0.1.0] Add the output channel logger with secret redaction ──
// ── [PCODE-11 | S02 | v0.1.0] Add the state store with a .plane file watcher and change events ──
// ── [PCODE-13 | S03 | v0.1.0] Add the Orqiva activity bar container and the Sprints tree view ──
// ── [PCODE-18 | S03 | v0.1.0] Show the board offline from sprints.md when Plane is unreachable ──
// ── [PCODE-14 | S03 | v0.1.0] Add Sync, Start, Done, Status and Note commands wired to the engine ──
// ── [PCODE-15 | S03 | v0.1.0] Add the status bar item showing active task, fingerprint and queue length ──
// ── [PCODE-16 | S03 | v0.1.0] Add the Start development command opening Claude Code in the integrated terminal ──
// ── [PCODE-17 | S03 | v0.1.0] Add live refresh: file watcher triggers plus Plane polling with backoff ──
// ── [PCODE-73 | S03 | v0.1.0] Support VS Code workspace trust: limited mode until the folder is trusted ──
// ── [PCODE-20 | S04 | v0.1.0] Build the task detail panel with description, acceptance, comments and badges ──
// ── [PCODE-22 | S04 | v0.1.0] Add action buttons to the task panel: Start, Done, Status, Note, Open in Plane ──
// ── [PCODE-23 | S04 | v0.1.0] Build the New task form creating items via plane new with a description file ──
// ── [PCODE-26 | S05 | v0.1.0] Add environment checks for Python, Node, Claude Code, git and the engine folder ──
// ── [PCODE-25 | S05 | v0.1.0] Add the Welcome view variants for no engine, no key and no linked project ──
// ── [PCODE-30 | S06 | v0.1.0] Add New project and Link project commands calling plane_init.py ──
// ── [PCODE-31 | S06 | v0.1.0] Build the plan panel: description status, Draft, Check and Publish ──
// ── [PCODE-32 | S06 | v0.1.0] Run Draft plan in the integrated terminal with the planning prompt ──
// ── [PCODE-34 | S06 | v0.1.0] Publish the plan with confirmation, single-flight guard and result summary ──
// ── [PCODE-35 | S07 | v0.1.0] Add the Docs tree view listing .plane documents with open and preview actions ──
// ── [PCODE-36 | S07 | v0.1.0] Add a fingerprint CodeLens provider showing task title and state above markers ──
// ── [PCODE-37 | S07 | v0.1.0] Add editor decorations for fingerprint lines with hover details ──
// ── [PCODE-38 | S07 | v0.1.0] Add an Insert fingerprint header command for the active task and file type ──
// ── [PCODE-27 | S05 | v0.1.0] Build the setup panel: environment checks, Plane connection and key storage ──
// ── [PCODE-77 | S08 | v0.1.0] Rename PlaneCode to ProdEngine (now Orqiva) with settings migration ──
// ── [PCODE-78 | S08 | v0.1.0] Add the Orqiva Home tab: guided setup steps and a visual task board ──
// ── [PCODE-79 | S08 | v0.1.0] Add the New project wizard: describe the idea, draft, review and publish the plan visually ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
// ── [PCODE-106 | S15 | v0.1.0] Add the team activity feed panel to VS Code ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/cb55079f-fd25-471d-9fe6-4c5790d15f89/
//    Why:  the extension entry point: build the services once, register commands; views come in Sprint 03.
import { InboxModel, InboxTreeProvider, type InboxEntry } from './server/inbox'; // [PCODE-193 | S15 | v0.1.0]
// [PCODE-236 | S15 | v0.1.0]
import {
  ConversationPanels,
  MessagesModel,
  MessagesTreeProvider,
  noticeText,
  notifies,
  titleOf,
  unreadOf,
} from './server/messages';
import type { ServerConnection } from './server/connection';
import { TimerStatus } from './views/timerStatus';
import { AgentsModel, AgentsTreeProvider, type AgentNode } from './server/agents'; // [PCODE-194 | S15 | v0.1.0]
import { FindingsProblems } from './server/findings';
import { LoopCommands } from './server/loopCommands';
import { CodeMapLensProvider, repoPath, type CodeFileJson } from './views/codeMapLens';
import { PresenceModel, PresenceStatus, onBlock } from './server/presence'; // [PCODE-196 | S15 | v0.1.0]
import {
  addSource,
  addedText,
  interview,
  interviewable,
  listIdeas,
  noteIdea,
  type IdeaJson,
  type SourceInput,
} from './server/ideas'; // [PCODE-272 | S15 | v0.1.0]
// [PCODE-201 | S15 | v0.1.0] docs from code and the handover
import {
  handoverOf,
  handoverPicks,
  handoverTitle,
  rebuildDocs,
  sendPack,
  toggleItem,
} from './server/handover';
// [PCODE-207 | S15 | v0.1.0] environments: promote, approve, roll back
import { pipelineOf, releasePicks, runPick } from './server/releases';
import { registerReview } from './commands/reviewCommands'; // [PCODE-311 | S15 | v0.1.0]
import {
  applyLegacyEnv,
  isEventOf,
  type ChannelJson, // [PCODE-236 | S15 | v0.1.0]
  type ChatEvent,
} from '@orqiva/shared';
import * as vscode from 'vscode';
import { createServices, type Services } from './services';
import { todayIso } from './state/board';
import { homedir } from 'node:os';
import { fetchBoard } from './state/boardFetch';
import { BoardSource } from './state/boardSource';
import { ActivityFeed } from './server/feed';
import { ActivityTreeProvider, OPEN_ACTIVITY_ITEM } from './views/activityTree';
import { registerDevCommands } from './commands/devCommands';
import { registerFingerprintCommands } from './commands/fingerprintCommands';
import { registerPanelCommands } from './commands/panelCommands';
import { registerSetupCommands } from './commands/setupCommands';
import { registerProjectCommands } from './commands/projectCommands';
import { openDescription, openPlanPanel } from './webviews/plan/panel';
import { draftPlan } from './plan/draft';
import { PlanningSession } from './plan/session';
import { defaultInstalledOrq } from './plan/portal';
import { applyUpdate, checkForUpdate, ownBuild, when } from './update/updater';
import { registerDocsView, type DocsTreeProvider } from './views/docsTree';
import { registerDocsCommands } from './commands/docsCommands';
import { openVersionPanel } from './webviews/version/panel';
import { disposeDockerChannel, openDockerPanel } from './webviews/docker/panel';
import { runDockerGenerate } from './commands/dockerCommands';
import { openDeployPanel } from './webviews/deploy/panel';
import { loadHistory, recordAttempt } from './deploy/history';
import { openSecurityPanel } from './webviews/security/panel';
import { openDashboardPanel } from './webviews/dashboard/panel';
import { rememberFolder } from './dashboard/folders';
import {
  recentItems,
  refreshRecentContext,
  registerRecentCommands,
} from './commands/recentCommands';
import { announce, registerReleaseCommands, runBump } from './commands/releaseCommands';
import { IssueCache } from './plane/issueCache';
import { registerCodeLens } from './views/codelens';
import { registerDecorations } from './views/decorations';
import { registerInsertFingerprint } from './commands/insertFingerprint';
import { orderOnce, publishPlan, resultMessage } from './plan/publish';
import { info, showError } from './commands/notify';
import { panelRunner, registerTaskCommands, type TaskCommandDeps } from './commands/taskCommands';
import { openNewTaskPanel } from './webviews/newTask/panel';
import { StatusBar } from './views/statusBar';
import { WelcomeState } from './views/welcome';
import { openSetupPanel } from './webviews/setup/panel';
import { migrateSettings } from './setup/migrate';
import { openHomePanel } from './webviews/home/panel';
import { SprintsTreeProvider } from './views/sprintsTree';

let services: Services | undefined;
let sprintsTreeRef: SprintsTreeProvider | undefined;
let docsTreeRef: DocsTreeProvider | undefined; // [PCODE-44 | S08 | v0.1.0]

// ── [PCODE-1 | S01 | v0.1.0] activate: register commands; must stay fast and offline ──
// ── [PCODE-11 | S02 | v0.1.0] services are built from files only; the engine is located lazily ──
// [PCODE-192 | S15 | v0.1.0] PRODENGINE_* variables of the terminal still count
applyLegacyEnv();

export function activate(context: vscode.ExtensionContext): {
  getServices: () => Services | undefined;
  getSprintsTree: () => SprintsTreeProvider | undefined;
  getDocsTree: () => DocsTreeProvider | undefined; // [PCODE-44 | S08 | v0.1.0] read by the docs e2e test
} {
  const svc = createServices(context);
  services = svc;
  const { log, store } = svc;
  context.subscriptions.push(svc, log);
  // [PCODE-77 | S08 | v0.1.0] orqiva.* settings carried over; never awaited (critical #10)
  const config = vscode.workspace.getConfiguration();
  void migrateSettings({
    inspect: (key) => config.inspect(key),
    update: (key, value, scope) =>
      config.update(
        key,
        value,
        scope === 'global'
          ? vscode.ConfigurationTarget.Global
          : vscode.ConfigurationTarget.Workspace,
      ),
  })
    .then((moved) => {
      if (moved.length > 0) log.info(`settings carried over from Orqiva: ${moved.join(', ')}`);
    })
    .catch((e: unknown) => {
      log.error('settings migration', e);
    });
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.hello', () => {
      log.info('hello command');
      void vscode.window.showInformationMessage('Orqiva is ready');
    }),
  );
  // ── [PCODE-13 | S03 | v0.1.0] the Sprints view ──
  const sprintsTree = new SprintsTreeProvider(store);
  sprintsTreeRef = sprintsTree;
  const treeView = vscode.window.createTreeView('orqiva.sprints', {
    treeDataProvider: sprintsTree,
    showCollapseAll: true,
  });
  context.subscriptions.push(sprintsTree, treeView);
  const docsView = registerDocsView(context, store); // [PCODE-35 | S07 | v0.1.0] the Docs view
  // ── [PCODE-106 | S15 | v0.1.0] the Activity view: the team's events, live, on Orqiva ──
  const feed = new ActivityFeed();
  const activityTree = new ActivityTreeProvider(feed);
  context.subscriptions.push(
    activityTree,
    vscode.window.createTreeView('orqiva.activity', { treeDataProvider: activityTree }),
    vscode.commands.registerCommand(OPEN_ACTIVITY_ITEM, (itemId: unknown) => {
      const server = store.state.link?.server;
      if (typeof itemId !== 'string' || !server) return;
      void vscode.env.openExternal(
        vscode.Uri.parse(server.replace(/\/$/, '') + '/items/' + itemId),
      );
    }),
  );
  const setOnServerKey = (): void => {
    void vscode.commands.executeCommand(
      'setContext',
      'orqiva.onServer',
      !!store.state.link?.server,
    );
  };
  setOnServerKey();
  context.subscriptions.push(
    store.onDidChange((keys) => {
      if (keys.includes('link')) setOnServerKey();
    }),
  );
  docsTreeRef = docsView;
  registerReleaseCommands(context, svc); // [PCODE-48 | S09 | v0.1.0] orqiva.bumpVersion
  // [PCODE-65 | S13 | v0.1.0] the workspace dashboard, and the folder this window teaches it
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.openDashboard', () => {
      void openDashboardPanel({ context, services: svc }).catch((e: unknown) => {
        log.error('dashboard panel', e);
      });
    }),
  );
  {
    const remember = (): void => {
      const link = store.state.link;
      const root = store.state.root;
      if (link?.identifier && root)
        void rememberFolder(context.globalState, link.identifier, root).catch(() => undefined);
    };
    remember();
    context.subscriptions.push(
      store.onDidChange((keys) => {
        if (keys.includes('link')) remember();
      }),
    );
    // [PCODE-67 | S13 | v0.1.0] the welcome view offers the folders this machine already knows
    registerRecentCommands(context, () => store.state.root);
    void refreshRecentContext(
      context.globalState,
      undefined,
      undefined,
      () => store.state.root,
    ).catch(() => undefined);
  }
  // [PCODE-60 | S12 | v0.1.0] the security checklist panel (Docs view entry + palette)
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.openSecurityPanel', () => {
      void openSecurityPanel({
        context,
        services: svc,
        onChanged: () => {
          docsView.refresh();
        },
      }).catch((e: unknown) => {
        log.error('security panel', e);
      });
    }),
  );
  // [PCODE-58 | S11 | v0.1.0] the Deploy panel; [PCODE-59] every attempt lands on the Release item
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.openDeployPanel', () => {
      const historyDeps = (): Parameters<typeof recordAttempt>[1] => ({
        client: svc.client,
        engine: svc.engine,
        store: svc.store,
        hasApiKey: () => svc.secrets.hasApiKey(),
        log: (l: string) => {
          svc.log.warn(l);
        },
      });
      void openDeployPanel({
        context,
        services: svc,
        onAttempt: async (attempt) => {
          await recordAttempt(
            { ...attempt, date: new Date().toISOString().slice(0, 10) },
            historyDeps(),
          );
        },
        loadHistory: (version) => loadHistory(version, historyDeps()),
      }).catch((e: unknown) => {
        log.error('deploy panel', e);
      });
    }),
  );
  // [PCODE-51 | S10 | v0.1.0] the Docker panel (Docs view Docker node + palette)
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.openDockerPanel', () => {
      void openDockerPanel({
        context,
        services: svc,
        onGenerate: () => runDockerGenerate(svc), // [PCODE-52 | S10 | v0.1.0]
      }).catch((e: unknown) => {
        log.error('docker panel', e);
      });
    }),
    // [PCODE-52 | S10 | v0.1.0] the same flow from the palette
    vscode.commands.registerCommand('orqiva.generateDockerFiles', () => runDockerGenerate(svc)),
    { dispose: disposeDockerChannel },
  );
  // [PCODE-46 | S09 | v0.1.0] the version panel (Docs view Release node + palette)
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.openVersionPanel', () => {
      void openVersionPanel({
        context,
        services: svc,
        onBump: async (part) => {
          const r = await runBump(svc, part); // [PCODE-48 | S09 | v0.1.0]
          if (r) announce(r); // [PCODE-49 | S09 | v0.1.0]
        },
      }).catch((e: unknown) => {
        log.error('version panel', e);
      });
    }),
  );
  // [PCODE-42 | S08 | v0.1.0] Generate code documentation; the Docs view shows the pages at once
  registerDocsCommands(context, svc, () => {
    docsView.refresh();
  });
  // [PCODE-36 | S07 | v0.1.0] fingerprint lenses: board first, Plane for unknown refs
  const issueCache = new IssueCache({
    store,
    client: svc.client,
    hasApiKey: () => svc.secrets.hasApiKey(),
  });
  context.subscriptions.push(issueCache);
  const codeLens = registerCodeLens(context, issueCache);
  const decorator = registerDecorations(context, issueCache); // [PCODE-37 | S07 | v0.1.0]
  context.subscriptions.push(
    store.onDidChange((keys) => {
      if (keys.includes('sprints') || keys.includes('active')) {
        codeLens.refresh();
        decorator.refreshAll();
      }
      if (keys.includes('online') && store.state.online) issueCache.invalidate();
    }),
  );
  // ── [PCODE-193 | S15 | v0.1.0] the inbox and the timer, from the same live connection as the board ──
  let boardRef: BoardSource | null = null;
  const live = (): { api: ServerConnection['api']; workspaceId: string; server: string } | null => {
    const c = boardRef?.connection ?? null;
    return c ? { api: c.api, workspaceId: c.link.workspaceId, server: c.link.server } : null;
  };
  const inbox = new InboxModel(live);
  const inboxTree = new InboxTreeProvider(inbox);
  const inboxView = vscode.window.createTreeView('orqiva.inbox', { treeDataProvider: inboxTree });
  const timer = new TimerStatus(live);
  context.subscriptions.push(inbox, inboxTree, inboxView, timer);
  // ── [PCODE-236 | S15 | v0.1.0] the team's conversations, from the same connection ──
  const messages = new MessagesModel(live);
  const messagesTree = new MessagesTreeProvider(messages);
  const messagesView = vscode.window.createTreeView('orqiva.messages', {
    treeDataProvider: messagesTree,
  });
  const conversations = new ConversationPanels(context, messages, (l) => {
    log.info(l);
  });
  context.subscriptions.push(
    messages,
    messagesTree,
    messagesView,
    conversations,
    messages.onDidChange(() => {
      const n = unreadOf(messages.channels());
      messagesView.badge = n ? { value: n, tooltip: String(n) + ' unread' } : undefined;
    }),
    vscode.commands.registerCommand('orqiva.messages.open', (c?: ChannelJson) =>
      c ? conversations.show(c).catch(failed('The conversation did not open')) : undefined,
    ),
    vscode.commands.registerCommand('orqiva.messages.refresh', () => messages.refresh()),
  );
  /** a live change: the list and an open conversation follow; a mention or a direct message notifies */
  const onChat = (c: ChatEvent): void => {
    messages.refreshSoon();
    conversations.onChat(c);
    if (c.op !== 'message') return;
    const channel = messages.channel(c.message.channelId);
    if (!notifies(c.message, channel, messages.me) || conversations.showing(c.message.channelId))
      return;
    const where = channel ? titleOf(channel, messages.me?.id ?? null) : 'a conversation';
    void vscode.window
      .showInformationMessage(noticeText(c.message, where), 'Open')
      .then((pick) => (pick && channel ? conversations.show(channel) : undefined));
  };
  // ── [PCODE-194 | S15 | v0.1.0] agents, findings and the code map, from the same connection ──
  const project = (): {
    api: ServerConnection['api'];
    workspaceId: string;
    projectId: string;
    server: string;
    root: string;
  } | null => {
    const c = boardRef?.connection ?? null;
    const root = store.state.root;
    return c && root
      ? {
          api: c.api,
          workspaceId: c.link.workspaceId,
          projectId: c.link.projectId,
          server: c.link.server,
          root,
        }
      : null;
  };
  const agents = new AgentsModel(project);
  const agentsTree = new AgentsTreeProvider(agents);
  const agentsView = vscode.window.createTreeView('orqiva.agents', {
    treeDataProvider: agentsTree,
  });
  const findings = new FindingsProblems(project);
  const codeMap = new CodeMapLensProvider(project);
  context.subscriptions.push(
    agents,
    agentsTree,
    agentsView,
    findings,
    codeMap,
    vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, findings, {
      providedCodeActionKinds: FindingsProblems.kinds,
    }),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeMap),
    agents.onDidChange(() => {
      const n = agents
        .runs()
        .filter((r) => r.status === 'running' || r.status === 'waiting').length;
      agentsView.badge = n ? { value: n, tooltip: String(n) + ' agent runs going' } : undefined;
    }),
    vscode.window.onDidChangeWindowState((w) => {
      if (w.focused) {
        void findings.refresh();
        void codeMap.refresh();
      }
    }),
  );
  const refreshProject = (): void => {
    void agents.refresh();
    void findings.refresh();
    void codeMap.refresh();
  };
  // ── [PCODE-196 | S15 | v0.1.0] presence: where I am (with the file, where the workspace allows it), who else is here ──
  const presence = new PresenceModel();
  const activeFile = (): string | null => {
    const root = store.state.root;
    const doc = vscode.window.activeTextEditor?.document;
    return root && doc?.uri.scheme === 'file' ? repoPath(root, doc.uri.fsPath) : null;
  };
  const presenceStatus = new PresenceStatus(presence, activeFile);
  const itemIdOf = (ref: string): string | null =>
    store.state.sprints.flatMap((x) => x.items).find((i) => i.ref === ref)?.id ?? null;
  codeLens.setPresence((ref, fsPath) => {
    const root = store.state.root;
    return onBlock(
      presence.people(),
      presence.me,
      root ? repoPath(root, fsPath) : null,
      itemIdOf(ref),
    );
  });
  let lastPlace = '';
  const reportPlace = (): void => {
    const c = boardRef?.connection ?? null;
    if (!c) return;
    const ref = store.state.active?.task ?? null;
    const place = {
      projectId: c.link.projectId,
      itemId: ref ? itemIdOf(ref) : null,
      state: vscode.window.activeTextEditor?.document.isDirty
        ? ('editing' as const)
        : ('viewing' as const),
      file: activeFile(),
    };
    const key = JSON.stringify(place);
    if (key === lastPlace) return;
    lastPlace = key;
    c.setPlace(place);
    presenceStatus.render();
  };
  context.subscriptions.push(
    presence,
    presenceStatus,
    presence.onDidChange(() => {
      codeLens.refresh();
    }),
    vscode.window.onDidChangeActiveTextEditor(reportPlace),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) reportPlace();
    }),
    vscode.workspace.onDidSaveTextDocument(reportPlace),
    store.onDidChange((keys) => {
      if (keys.includes('active') || keys.includes('sprints')) reportPlace();
    }),
  );
  /** Who I am on this server, read once per connection, so the others can be told apart. */
  const whoAmI = async (): Promise<void> => {
    const c = boardRef?.connection ?? null;
    if (!c || presence.me) return;
    const me = await c.api.call<{ user: { id: string } }>('GET', '/auth/me').catch(() => null);
    presence.me = me?.user.id ?? null;
  };
  context.subscriptions.push(
    inbox.onDidChange(() => {
      const n = inbox.entries().length;
      inboxView.badge = n ? { value: n, tooltip: String(n) + ' waiting for you' } : undefined;
    }),
  );
  // ── [PCODE-105 | S15 | v0.1.0] the board: live from Orqiva, or read on demand from Plane; no timer ──
  const boardSource = new BoardSource({
    store,
    home: homedir(),
    onChat, // [PCODE-236 | S15 | v0.1.0]
    // [PCODE-106 | S15 | v0.1.0] the same connection feeds the Activity view
    onEvent: (e) => {
      feed.add(e);
      inbox.refreshSoon(); // [PCODE-193 | S15 | v0.1.0] a new notice, an approval answered elsewhere
      // [PCODE-194 | S15 | v0.1.0] a run moved on, a finding came or went
      if (isEventOf(e.type, 'agent_run')) agents.refreshSoon();
      if (isEventOf(e.type, 'finding')) findings.refreshSoon();
    },
    onHistory: (events) => {
      feed.reset(events);
    },
    // [PCODE-196 | S15 | v0.1.0] who is where; the first snapshot also says the connection is up
    onPresence: (people) => {
      void whoAmI().then(() => {
        presence.set(people);
        reportPlace();
      });
    },
    fetchPlane: async () => {
      const link = store.state.link;
      if (!link || link.server || !(await svc.secrets.hasApiKey())) return null;
      return fetchBoard(svc.client, link.project_id, link.identifier, todayIso());
    },
    log: (l) => {
      log.info(l);
    },
  });
  svc.refreshBoard = () => boardSource.refreshNow();
  boardRef = boardSource; // [PCODE-193 | S15 | v0.1.0]
  svc.server = () => boardSource.connection;
  context.subscriptions.push(boardSource);
  // a folder linked or relinked (orq link, Link project) reconnects without a reload
  context.subscriptions.push(
    store.onDidChange((keys) => {
      if (keys.includes('link')) {
        boardSource.start();
        void inbox.refresh(); // [PCODE-193 | S15 | v0.1.0]
        messages.forget(); // [PCODE-236 | S15 | v0.1.0] another server, other conversations
        void messages.refresh();
        void timer.refresh();
        refreshProject(); // [PCODE-194 | S15 | v0.1.0]
        presence.me = null; // [PCODE-196 | S15 | v0.1.0] another server, another me
        lastPlace = '';
      }
    }),
  );
  const describeTree = (): void => {
    const st = store.state;
    treeView.description = !st.link
      ? ''
      : st.online
        ? ''
        : /rate limit/i.test(st.lastError ?? '')
          ? 'Tracker: rate limited'
          : st.lastError
            ? 'offline'
            : 'from last sync';
  };
  describeTree();
  context.subscriptions.push(
    store.onDidChange((keys) => {
      if (keys.includes('online') || keys.includes('link')) describeTree();
    }),
  );
  // ── [PCODE-73 | S03 | v0.1.0] trust: log the mode; when trust is granted later, refresh without a reload ──
  log.info(
    vscode.workspace.isTrusted
      ? 'workspace trusted'
      : 'workspace in Restricted Mode: engine and terminal disabled until trusted',
  );
  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      log.info('workspace trust granted');
      void svc.refreshBoard?.();
    }),
  );
  if (store.state.link) boardSource.start();
  void inbox.refresh(); // [PCODE-193 | S15 | v0.1.0]
  void messages.refresh(); // [PCODE-236 | S15 | v0.1.0]
  void timer.refresh();
  refreshProject(); // [PCODE-194 | S15 | v0.1.0]
  // ── [PCODE-193 | S15 | v0.1.0] inbox actions and the timer ──
  // [PCODE-196 | S15 | v0.1.0] the interview: each question in an input box until the summary is written
  const runInterview = async (idea: IdeaJson): Promise<void> => {
    const src = project();
    if (!src) return;
    let step = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: idea.ref + ': the interviewer reads it',
      },
      () => interview(src, idea.id),
    );
    while (!step.idea.interviewDone) {
      if (!step.question) {
        info(
          idea.ref + ': the interviewer is still thinking. Orqiva: Idea interview goes on later.',
        );
        return;
      }
      const answer = await vscode.window.showInputBox({
        title: idea.ref + ' ' + idea.title,
        prompt: step.question,
        placeHolder: 'Your answer (Escape: go on later, here or on the web)',
        ignoreFocusOut: true,
      });
      if (!answer?.trim()) return;
      step = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: idea.ref + ': next question…' },
        () => interview(src, idea.id, answer.trim()),
      );
    }
    info(idea.ref + ' interview done. Summary: ' + step.idea.summary.slice(0, 300));
  };
  const testOutput = vscode.window.createOutputChannel('Orqiva tests'); // [PCODE-194 | S15 | v0.1.0]
  context.subscriptions.push(testOutput);
  const failed =
    (what: string) =>
    (e: unknown): void => {
      void showError(what, e, log);
    };
  // [PCODE-311 | S15 | v0.1.0] code review: the queue, the diff and the line comments
  registerReview(
    context,
    () => {
      const p = project();
      return p ? { api: p.api, workspaceId: p.workspaceId, projectId: p.projectId } : null;
    },
    failed,
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.inbox.open', async (e?: InboxEntry) => {
      if (!e) return;
      const url = inbox.urlOf(e);
      void inbox.act(e, 'read').catch(() => undefined);
      if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand('orqiva.inbox.done', (e?: InboxEntry) =>
      e ? inbox.act(e, 'done').catch(failed('Not marked done')) : undefined,
    ),
    vscode.commands.registerCommand('orqiva.inbox.snooze', (e?: InboxEntry) =>
      e ? inbox.act(e, 'snooze').catch(failed('Not snoozed')) : undefined,
    ),
    vscode.commands.registerCommand('orqiva.inbox.approve', (e?: InboxEntry) =>
      e
        ? inbox
            .decide(e, true)
            .then(() => {
              info('Approved: the agent goes on.');
            })
            .catch(failed('Not approved'))
        : undefined,
    ),
    vscode.commands.registerCommand('orqiva.inbox.decline', async (e?: InboxEntry) => {
      if (!e) return;
      const note = await vscode.window.showInputBox({
        prompt: 'Why not? The agent reads this.',
        placeHolder: 'e.g. not on staging today',
      });
      if (note === undefined) return;
      await inbox.decide(e, false, note.trim() || undefined).catch(failed('Not declined'));
    }),
    vscode.commands.registerCommand('orqiva.inbox.refresh', () => inbox.refresh()),
    // ── [PCODE-194 | S15 | v0.1.0] agents, findings, the code map and tests ──
    vscode.commands.registerCommand('orqiva.agents.refresh', () => agents.refresh()),
    vscode.commands.registerCommand('orqiva.agents.ask', async () => {
      const list = await agents.agents().catch((e: unknown) => {
        failed('Agents not read')(e);
        return null;
      });
      if (!list) return;
      if (!list.length) {
        info('No agent is switched on in this workspace.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        list.map((a) => ({ label: a.name, detail: a.description, id: a.id })),
        { placeHolder: 'Which agent?' },
      );
      if (!pick) return;
      const ref = store.state.active?.task ?? null;
      const item = ref
        ? store.state.sprints.flatMap((x) => x.items).find((i) => i.ref === ref)
        : undefined;
      const instruction = await vscode.window.showInputBox({
        prompt: item
          ? 'What should ' + pick.label + ' do on ' + item.ref + '?'
          : 'What should ' + pick.label + ' do in this project?',
        placeHolder: 'e.g. write tests for the acceptance criteria',
      });
      if (!instruction?.trim()) return;
      try {
        await agents.ask(pick.id, instruction.trim(), item?.id ?? null);
        info(pick.label + ' is on it. Follow it in the Agents view.');
      } catch (e) {
        failed('The agent was not asked')(e);
      }
    }),
    vscode.commands.registerCommand('orqiva.agents.cancel', async (n?: AgentNode) => {
      if (!n) return;
      await agents.cancel(n.run).catch(failed('The run was not stopped'));
    }),
    vscode.commands.registerCommand('orqiva.agents.open', async (n?: AgentNode) => {
      const url = n ? agents.urlOf(n.run) : null;
      if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand('orqiva.agents.pause', () =>
      agents
        .pauseAll(true)
        .then(() => {
          info('All agents paused: running steps finish, nothing new starts.');
        })
        .catch(failed('Agents not paused')),
    ),
    vscode.commands.registerCommand('orqiva.agents.resume', () =>
      agents
        .pauseAll(false)
        .then(() => {
          info('Agents resumed.');
        })
        .catch(failed('Agents not resumed')),
    ),
    vscode.commands.registerCommand('orqiva.findings.makeTask', async (findingId?: string) => {
      if (!findingId) return;
      try {
        const ref = await findings.makeTask(findingId);
        info(ref ? 'Task ' + ref + ' made for the finding.' : 'Task made for the finding.');
        await svc.refreshBoard?.();
      } catch (e) {
        failed('No task made')(e);
      }
    }),
    vscode.commands.registerCommand('orqiva.findings.refresh', () => findings.refresh()),
    vscode.commands.registerCommand('orqiva.codeMap.open', async (f?: CodeFileJson) => {
      const url = f ? codeMap.urlOf(f) : null;
      if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    // ── [PCODE-196 | S15 | v0.1.0] ideas: note one, answer the interviewer one question at a time ──
    vscode.commands.registerCommand('orqiva.ideas.new', async () => {
      const src = project();
      if (!src) {
        info('Ideas need the folder linked to Orqiva (orq link).');
        return;
      }
      const title = await vscode.window.showInputBox({
        prompt: 'The idea in a few words',
        placeHolder: 'e.g. Reminders by SMS before an appointment',
        ignoreFocusOut: true,
      });
      if (!title?.trim()) return;
      const body = await vscode.window.showInputBox({
        prompt: 'Anything to add? (optional: the interviewer asks the rest)',
        ignoreFocusOut: true,
      });
      if (body === undefined) return;
      try {
        const idea = await noteIdea(src, title.trim(), body.trim());
        await runInterview(idea);
      } catch (e) {
        failed('The idea was not noted')(e);
      }
    }),
    vscode.commands.registerCommand('orqiva.ideas.interview', async () => {
      const src = project();
      if (!src) {
        info('Ideas need the folder linked to Orqiva (orq link).');
        return;
      }
      try {
        const open = interviewable(await listIdeas(src));
        if (!open.length) {
          info('No idea waits for its interview. Orqiva: Note an idea starts one.');
          return;
        }
        const pick = await vscode.window.showQuickPick(
          open.map((i) => ({ label: i.ref, description: i.title, idea: i })),
          { placeHolder: 'Which idea?' },
        );
        if (pick) await runInterview(pick.idea);
      } catch (e) {
        failed('The interview did not open')(e);
      }
    }),
    // ── [PCODE-272 | S15 | v0.1.0] a source for an idea: the selection, this file, a link or text ──
    vscode.commands.registerCommand('orqiva.ideas.addSource', async () => {
      const src = project();
      if (!src) {
        info('Ideas need the folder linked to Orqiva (orq link).');
        return;
      }
      try {
        const ideas = (await listIdeas(src)).filter(
          (i) => i.status !== 'approved' && i.status !== 'declined',
        );
        if (!ideas.length) {
          info('No open idea. Orqiva: Note an idea starts one.');
          return;
        }
        const idea = await vscode.window.showQuickPick(
          ideas.map((i) => ({ label: i.ref, description: i.title, idea: i })),
          { placeHolder: 'Add a source to which idea?' },
        );
        if (!idea) return;
        const editor = vscode.window.activeTextEditor;
        const doc = editor?.document;
        const where = doc ? vscode.workspace.asRelativePath(doc.uri) : '';
        const picks: { label: string; detail: string; key: string }[] = [
          ...(editor && !editor.selection.isEmpty
            ? [{ label: 'The selection', detail: where, key: 'selection' }]
            : []),
          ...(doc && doc.uri.scheme === 'file'
            ? [{ label: 'This file', detail: where, key: 'file' }]
            : []),
          { label: 'A link…', detail: 'The server reads the page or file behind it', key: 'link' },
          { label: 'Text or a quote…', detail: 'Typed or pasted', key: 'text' },
        ];
        const what = await vscode.window.showQuickPick(picks, {
          placeHolder: 'What is the source?',
        });
        if (!what) return;
        let input: SourceInput | null = null;
        if (what.key === 'selection' && editor && doc) {
          const sel = editor.selection;
          input = {
            kind: 'text',
            body: doc.getText(sel),
            title:
              where +
              ':' +
              String(sel.start.line + 1) +
              (sel.end.line > sel.start.line ? '-' + String(sel.end.line + 1) : ''),
          };
        } else if (what.key === 'file' && doc) {
          const data = await vscode.workspace.fs.readFile(doc.uri);
          input = { kind: 'file', name: where.split('/').pop() ?? where, data };
        } else if (what.key === 'link') {
          const url = await vscode.window.showInputBox({
            prompt: 'The address (http or https)',
            placeHolder: 'https://…',
            ignoreFocusOut: true,
            validateInput: (v) =>
              /^https?:\/\/\S+$/i.test(v.trim()) ? null : 'An http or https address',
          });
          if (url) input = { kind: 'link', url: url.trim() };
        } else if (what.key === 'text') {
          const body = await vscode.window.showInputBox({
            prompt: 'The text or the quote',
            ignoreFocusOut: true,
          });
          if (!body?.trim()) return;
          const saidBy = await vscode.window.showInputBox({
            prompt: 'Who said it? (optional: leave empty for plain text)',
            ignoreFocusOut: true,
          });
          if (saidBy === undefined) return;
          input = {
            kind: 'text',
            body: body.trim(),
            ...(saidBy.trim() ? { saidBy: saidBy.trim() } : {}),
          };
        }
        if (!input) return;
        const sent = input;
        const added = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: idea.idea.ref + ': adding the source…',
          },
          () => addSource(src, idea.idea.id, sent),
        );
        info(addedText(idea.idea.ref, added));
      } catch (e) {
        failed('The source was not added')(e);
      }
    }),
    // ── [PCODE-201 | S15 | v0.1.0] rebuild the docs from the code; the handover in a quick pick ──
    vscode.commands.registerCommand('orqiva.docs.rebuild', async () => {
      const src = project();
      if (!src) {
        info('Docs from code need the folder linked to Orqiva (orq link).');
        return;
      }
      try {
        info(await rebuildDocs(src));
      } catch (e) {
        failed('The docs were not rebuilt')(e);
      }
    }),
    vscode.commands.registerCommand('orqiva.handover', async () => {
      const src = project();
      if (!src) {
        info('The handover needs the folder linked to Orqiva (orq link).');
        return;
      }
      try {
        for (;;) {
          const h = await handoverOf(src);
          const pick = await vscode.window.showQuickPick(handoverPicks(h), {
            title: handoverTitle(h),
            placeHolder: 'Pick a checklist item to tick it',
          });
          if (!pick || pick.action === 'none') return;
          if (pick.action === 'toggle') {
            await toggleItem(src, pick.itemId, pick.done);
            continue;
          }
          const note = await vscode.window.showInputBox({
            prompt: 'A note for the client (optional)',
            ignoreFocusOut: true,
          });
          if (note === undefined) return;
          info(
            'Sent handover pack ' +
              String(await sendPack(src, note)) +
              '. The client signs it in the portal.',
          );
          return;
        }
      } catch (e) {
        failed('The handover did not open')(e);
      }
    }),
    // ── [PCODE-207 | S15 | v0.1.0] the environments in a quick pick: promote, decide, roll back ──
    vscode.commands.registerCommand('orqiva.releases', async () => {
      const src = project();
      if (!src) {
        info('Releases need the folder linked to Orqiva (orq link).');
        return;
      }
      try {
        const envs = await pipelineOf(src);
        if (!envs.length) {
          info('The project has no environments yet.');
          return;
        }
        const pick = await vscode.window.showQuickPick(releasePicks(envs), {
          title: 'Releases and environments',
          placeHolder: 'Pick what to do',
        });
        if (!pick || pick.action === 'none') return;
        let text = '';
        if (pick.action === 'rollback' || pick.action === 'decline') {
          const t = await vscode.window.showInputBox({
            prompt: pick.action === 'rollback' ? 'Why roll back?' : 'Why decline?',
            ignoreFocusOut: true,
            validateInput: (v) => (v.trim() ? null : 'A reason is needed'),
          });
          if (!t) return;
          text = t;
        }
        info(await runPick(src, pick, text));
      } catch (e) {
        failed('That did not work')(e);
      }
    }),
    vscode.commands.registerCommand('orqiva.runTests', async () => {
      const engine = svc.engine;
      if (!(engine instanceof LoopCommands)) return;
      const command = await vscode.window.showInputBox({
        prompt: 'The test command; it must write TAP (each result goes to Orqiva)',
        value:
          context.workspaceState.get<string>('orqiva.testCommand') ??
          'npx vitest run --reporter=tap-flat',
      });
      if (!command?.trim()) return;
      await context.workspaceState.update('orqiva.testCommand', command.trim());
      testOutput.clear();
      testOutput.show(true);
      try {
        const r = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: 'Orqiva: running tests' },
          () =>
            engine.runTests(command.trim(), (line) => {
              testOutput.appendLine(line);
            }),
        );
        testOutput.appendLine(r.summary);
        info(r.summary);
      } catch (e) {
        failed('The tests did not run')(e);
      }
    }),
    vscode.commands.registerCommand('orqiva.timerToggle', async () => {
      const ref = store.state.active?.task ?? null;
      const item = ref
        ? store.state.sprints.flatMap((x) => x.items).find((i) => i.ref === ref)
        : undefined;
      try {
        const msg = await timer.toggle(item?.id ?? null);
        info(msg);
      } catch (e) {
        failed('The timer did not change')(e);
      }
    }),
  );
  // ── [PCODE-14 | S03 | v0.1.0] the loop commands; refresh re-reads files (the poller extends it in PCODE-17) ──
  const taskDeps: TaskCommandDeps = {
    services: svc,
    refresh: async () => {
      store.load(store.state.root);
      await svc.refreshBoard?.();
    },
  };
  const taskCmds = registerTaskCommands(context, taskDeps);
  // [PCODE-23 | S04 | v0.1.0] the New task form; "Start it" runs the same start command as the tree
  taskDeps.openNewTask = () => {
    openNewTaskPanel({
      context,
      services: svc,
      refresh: taskDeps.refresh,
      startTask: (ref) => taskCmds['orqiva.startTask']?.(ref) ?? Promise.resolve(),
    });
  };
  // ── [PCODE-15 | S03 | v0.1.0] status bar + fingerprint commands ──
  context.subscriptions.push(new StatusBar(store));
  registerFingerprintCommands(context, svc);
  registerInsertFingerprint(context, svc); // [PCODE-38 | S07 | v0.1.0]
  // [PCODE-38 | S07 | v0.1.0] context key for the editor menu: only with an active task
  const setActiveKey = (): void => {
    void vscode.commands.executeCommand(
      'setContext',
      'orqiva.hasActiveTask',
      store.state.active !== null,
    );
  };
  setActiveKey();
  context.subscriptions.push(
    store.onDidChange((keys) => {
      if (keys.includes('active')) setActiveKey();
    }),
  );
  registerPanelCommands(context, svc, { runner: panelRunner(taskDeps) }); // [PCODE-20/22 | S04 | v0.1.0] task panel + actions
  registerDevCommands(context, svc); // [PCODE-16 | S03 | v0.1.0] Start development
  registerSetupCommands(context, svc); // [PCODE-26 | S05 | v0.1.0] environment checks
  // ── [PCODE-25 | S05 | v0.1.0] welcome variants: context keys from engine / key / link ──
  const welcome = new WelcomeState(svc);
  context.subscriptions.push(welcome);
  void vscode.commands.executeCommand('setContext', 'orqiva.linked', store.state.link !== null);
  void welcome.refresh();
  context.subscriptions.push(
    context.secrets.onDidChange(() => {
      void welcome.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('orqiva')) {
        void svc.location(true).then(() => welcome.refresh());
      }
    }),
    // [PCODE-27 | S05 | v0.1.0] Setup panel: checks + Connect; a successful connect starts the live board
    vscode.commands.registerCommand('orqiva.openSetup', () => {
      void openSetupPanel({
        context,
        services: svc,
        onConnected: async () => {
          await welcome.refresh();
          if (store.state.link) boardSource.start();
        },
      }).catch((e: unknown) => {
        log.error('setup panel', e);
      });
    }),
    // [PCODE-453 | S15 | v0.1.0] connecting is signing in to the Orqiva server
    vscode.commands.registerCommand('orqiva.connect', () => {
      void vscode.commands.executeCommand('orqiva.signIn');
    }),
  );
  // ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
  //    A folder on an Orqiva server plans in the Home tab: Claude's questions, the answers, then the plan;
  //    a legacy folder keeps the planning terminal.
  const planning = new PlanningSession({
    log,
    folder: () => {
      const root = svc.root();
      const link = store.state.link;
      return root && link
        ? { root, name: link.name, identifier: link.identifier, orqiva: Boolean(link.server) }
        : null;
    },
    claudeCommand: () =>
      vscode.workspace.getConfiguration('orqiva').get<string>('claudeCommand', 'claude'),
  });
  // when Claude is done (questions, or the plan), the Orqiva tab comes to the front with them
  let planningPhase = planning.state.phase;
  context.subscriptions.push(
    planning.onDidChange(() => {
      const { phase, error } = planning.state;
      if (planningPhase !== 'idle' && phase === 'idle' && error !== 'stopped')
        void vscode.commands.executeCommand('orqiva.openHome');
      planningPhase = phase;
    }),
  );
  // ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
  //    A plan published before the order existed gets it once: waits, To do, ready.
  if (context.extensionMode !== vscode.ExtensionMode.Test)
    setTimeout(() => {
      const root = svc.root();
      if (root && store.state.link?.server)
        void orderOnce(root, log).then((done) => {
          if (done) void vscode.commands.executeCommand('orqiva.sync');
        });
    }, 5_000);
  const startPlanning = async (): Promise<void> => {
    if (!store.state.link?.server) {
      await draftPlan({ services: svc });
      return;
    }
    await vscode.commands.executeCommand('orqiva.openHome');
    await planning.next();
    if (planning.state.error && planning.state.error !== 'stopped')
      throw new Error(planning.state.error);
  };
  // [PCODE-31 | S06 | v0.1.0] the plan panel + Open description (walkthrough step 4)
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.openPlanPanel', () => {
      void openPlanPanel({
        context,
        services: svc,
        // [PCODE-32 | S06 | v0.1.0] [PCODE-457 | S15 | v0.1.0] on Orqiva the conversation in the Home tab
        onDraft: () =>
          store.state.link?.server
            ? startPlanning().then(() => ({ closed: Promise.resolve() }))
            : draftPlan({ services: svc }),
        onPublish: () => publishPlan({ services: svc }), // [PCODE-34 | S06 | v0.1.0]
      }).catch((e: unknown) => {
        log.error('plan panel', e);
      });
    }),
    // [PCODE-79 | S08 | v0.1.0] Draft from the Home wizard: the same planning run as the Plan panel's button
    vscode.commands.registerCommand('orqiva.draftPlan', async () => {
      try {
        await startPlanning(); // [PCODE-457 | S15 | v0.1.0]
      } catch (e) {
        await showError('Draft plan', e, log);
      }
    }),
    // [PCODE-34 | S06 | v0.1.0] Publish from the palette: same check, confirmation and single flight
    vscode.commands.registerCommand('orqiva.publishPlan', async () => {
      try {
        const r = await publishPlan({ services: svc });
        if (r) info(resultMessage(r));
      } catch (e) {
        await showError('Publish plan', e, log);
      }
    }),
    vscode.commands.registerCommand('orqiva.openDescription', async () => {
      const root = store.state.root;
      if (!root) {
        void vscode.window.showInformationMessage('Link this folder to an Orqiva project first.');
        return;
      }
      await openDescription(root);
    }),
  );
  // [PCODE-30 | S06 | v0.1.0] New project / Link project through plane_init.py; the board follows without a reload
  registerProjectCommands(context, {
    services: svc,
    afterLink: async () => {
      await welcome.refresh();
      describeTree();
      if (store.state.link) boardSource.start();
    },
  });
  // ── [PCODE-78 | S08 | v0.1.0] the Home tab: every button is a command above; opens itself at startup ──
  const homeRunner = panelRunner(taskDeps);
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.openHome', () => {
      void openHomePanel({
        context,
        services: svc,
        welcome,
        runner: homeRunner,
        hasRecent: () => recentItems(context.globalState).length > 0,
        planning, // [PCODE-457 | S15 | v0.1.0]
      }).catch((e: unknown) => {
        log.error('home panel', e);
      });
    }),
  );
  // ── [PCODE-458 | S15 | v0.1.0] VS Code extension updates itself from GitHub: CI publishes the build, Update button installs it ──
  //    The button (Home tab, palette) checks GitHub and installs a newer build; at startup the same check
  //    runs quietly and only offers it. One check at a time.
  let updating: Promise<void> | null = null;
  const runUpdate = async (interactive: boolean): Promise<void> => {
    const cfg = vscode.workspace.getConfiguration('orqiva');
    const source = {
      repository: cfg.get<string>('update.repository', 'Farivarz/Orqiva'),
      release: cfg.get<string>('update.release', 'ide-latest'),
    };
    const token = async (): Promise<string | null> => {
      try {
        const s = await vscode.authentication.getSession(
          'github',
          ['repo'],
          interactive ? { createIfNone: true } : { silent: true },
        );
        return s?.accessToken ?? null;
      } catch {
        return null;
      }
    };
    const own = ownBuild(context.extensionPath);
    const check = await checkForUpdate(source, own, { token });
    if (!check.newer) {
      if (interactive)
        info('Orqiva is up to date' + (own ? ` (built ${when(own.builtAt)}).` : '.'));
      return;
    }
    const offer = `An Orqiva update is ready: built ${when(check.remote.builtAt)}.`;
    if (!interactive) {
      const pick = await vscode.window.showInformationMessage(offer, 'Update now', 'Later');
      if (pick !== 'Update now') return;
    }
    const done = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Updating Orqiva…' },
      () =>
        applyUpdate(check, {
          token,
          orqPath: defaultInstalledOrq(),
          install: async (vsix) => {
            await vscode.commands.executeCommand(
              'workbench.extensions.installExtension',
              vscode.Uri.file(vsix),
            );
          },
        }),
    );
    log.info(
      `updated from GitHub to ${check.remote.commit.slice(0, 7)} (${check.remote.builtAt}); orq ${done.orq}`,
    );
    const reload = await vscode.window.showInformationMessage(
      `Orqiva is updated to the build of ${when(check.remote.builtAt)}${done.orq === 'updated' ? ', and the orq command with it' : ''}. Reload VS Code to use it.`,
      'Reload now',
    );
    if (reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
  };
  const update = (interactive: boolean): Promise<void> =>
    (updating ??= runUpdate(interactive)
      .catch(async (e: unknown) => {
        if (interactive) await showError('Check for updates', e, log);
        else log.warn('update check: ' + String(e));
      })
      .finally(() => {
        updating = null;
      }));
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.checkForUpdates', () => update(true)),
  );
  if (
    vscode.workspace.getConfiguration('orqiva').get<boolean>('update.checkOnStartup', true) &&
    context.extensionMode === vscode.ExtensionMode.Production
  )
    setTimeout(() => void update(false), 15_000);

  const openOnStartup = vscode.workspace
    .getConfiguration('orqiva')
    .get<boolean>('home.openOnStartup', true);
  if (openOnStartup && context.extensionMode !== vscode.ExtensionMode.Test) {
    // after activation returns: opening a panel must never hold it up (critical #10)
    setTimeout(() => {
      void vscode.commands.executeCommand('orqiva.openHome');
    }, 0);
  }
  const manifest = context.extension.packageJSON as { version?: string };
  log.info(
    `Orqiva ${manifest.version ?? '?'} activated · project: ${store.state.link ? `${store.state.link.identifier} (${store.state.root ?? ''})` : 'none'} · active task: ${store.state.active?.task ?? 'none'}`,
  );
  return { getServices, getSprintsTree: () => sprintsTreeRef, getDocsTree: () => docsTreeRef };
}

/** For the e2e suite: the live services of this extension host. */
export function getServices(): Services | undefined {
  return services;
}

// ── [PCODE-1 | S01 | v0.1.0] deactivate: subscriptions are disposed by VS Code ──
export function deactivate(): void {
  services = undefined;
  sprintsTreeRef = undefined;
}
