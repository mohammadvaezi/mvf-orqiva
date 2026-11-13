// ── [PCODE-51 | S10 | v0.1.0] Build the Docker panel with generate, build, run, stop, logs and health ──
// ── [PCODE-54 | S10 | v0.1.0] Add the health check with configurable URL and timeout shown in the panel ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the webview: what Docker says about itself, which files the project has, the image tag, the five
//          buttons in the order they are used, the services and the log view.
import type { DockerMessage, DockerToHost, HostToDocker } from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';

const api = vscodeApi<DockerToHost>();
const app = document.getElementById('app') as HTMLDivElement;

let state: DockerMessage | null = null;
let busy: string | null = null;
let logLines: string[] = [];
let logging = false;
let message: { kind: 'error' | 'info'; text: string } | null = null;
let health: {
  lines: { name: string; state: string; text: string }[];
  summary: string;
  healthy: boolean;
  checking: boolean;
} | null = null;

function button(
  label: string,
  iconName: string,
  primary: boolean,
  enabled: boolean,
  onClick: () => void,
  busyKey: string,
): HTMLButtonElement {
  const loading = busy === busyKey;
  const b = el(
    'button',
    { class: `pc-btn${primary ? ' pc-btn--primary' : ''}`, type: 'button' },
    icon(loading ? 'loading' : iconName),
    loading ? 'Working…' : label,
  );
  b.disabled = !enabled || (busy !== null && busy !== busyKey);
  b.addEventListener('click', onClick);
  return b;
}

// ── [PCODE-51 | S10 | v0.1.0] render: Docker, files, image, actions, services, logs ──
function render(): void {
  app.replaceChildren();
  app.append(
    el(
      'div',
      { class: 'pc-header' },
      el('h1', { class: 'pc-title', text: 'Docker' }),
      el(
        'div',
        { class: 'pc-actions' },
        button(
          'Refresh',
          'refresh',
          false,
          true,
          () => {
            api.postMessage({ type: 'docker/refresh' });
          },
          'refresh',
        ),
        button(
          'Open output',
          'output',
          false,
          true,
          () => {
            api.postMessage({ type: 'docker/openOutput' });
          },
          'output',
        ),
      ),
    ),
  );
  if (message)
    app.append(
      el('div', {
        class: `pc-alert${message.kind === 'info' ? ' pc-alert--info' : ''}`,
        role: message.kind === 'error' ? 'alert' : 'status',
        text: message.text,
      }),
    );
  if (!state) {
    app.append(el('p', { class: 'pc-muted', text: 'Reading…' }));
    return;
  }
  const s = state;

  const machine = el(
    'section',
    { class: 'pc-section' },
    el('h2', { text: 'This computer' }),
    el(
      'p',
      { class: s.dockerOk ? '' : 'pc-hint pc-hint--error' },
      icon(s.dockerOk ? 'pass-filled' : 'error'),
      ` ${s.docker}`,
    ),
  );
  if (!s.dockerOk && s.fix) {
    const link = el('a', { href: '#', text: 'Get Docker Desktop' });
    link.addEventListener('click', (e) => {
      e.preventDefault();
      api.postMessage({ type: 'docker/openFix' });
    });
    machine.append(link);
  }
  app.append(machine);

  const files = el(
    'section',
    { class: 'pc-section' },
    el('h2', { text: 'Files' }),
    el('p', { class: s.hasDockerfile && s.composeFile ? 'pc-muted' : '', text: s.filesNote }),
    el('p', { class: 'pc-hint pc-mono', text: `image ${s.image}` }),
    el(
      'div',
      { class: 'pc-row' },
      button(
        'Generate with Claude',
        'sparkle',
        !s.hasDockerfile,
        s.buttons.generate,
        () => {
          api.postMessage({ type: 'docker/generate' });
        },
        'generate',
      ),
    ),
  );
  app.append(files);

  const actions = el(
    'section',
    { class: 'pc-section' },
    el('h2', { text: 'Run' }),
    el(
      'div',
      { class: 'pc-row' },
      button(
        'Build',
        'package',
        s.hasDockerfile,
        s.buttons.build,
        () => {
          api.postMessage({ type: 'docker/build' });
        },
        'build',
      ),
      button(
        'Run',
        'play',
        true,
        s.buttons.run,
        () => {
          api.postMessage({ type: 'docker/run' });
        },
        'run',
      ),
      button(
        'Stop',
        'debug-stop',
        false,
        s.buttons.stop,
        () => {
          api.postMessage({ type: 'docker/stop' });
        },
        'stop',
      ),
      button(
        logging ? 'Stop logs' : 'Logs',
        'output',
        false,
        s.buttons.logs || logging,
        () => {
          api.postMessage({ type: 'docker/logs', on: !logging });
        },
        'logs',
      ),
    ),
  );
  if (s.services.length) {
    const ul = el('ul', { class: 'pc-list' });
    for (const line of s.services)
      ul.append(
        el(
          'li',
          { class: 'pc-check' },
          icon(/running/.test(line) ? 'pass-filled' : 'circle-outline'),
          ` ${line}`,
        ),
      );
    actions.append(ul);
  } else if (s.composeFile) {
    actions.append(el('p', { class: 'pc-muted', text: 'Nothing running.' }));
  }
  app.append(actions);

  // [PCODE-54 | S10 | v0.1.0] health: a dot per service and one for the URL
  const healthSection = el('section', { class: 'pc-section' }, el('h2', { text: 'Health' }));
  if (health) {
    healthSection.append(
      el('p', {
        class: health.healthy ? '' : 'pc-muted',
        text: health.summary + (health.checking ? ' Checking…' : ''),
      }),
    );
    const ul = el('ul', { class: 'pc-list' });
    for (const line of health.lines)
      ul.append(
        el(
          'li',
          { class: 'pc-check' },
          icon(
            line.state === 'healthy'
              ? 'pass-filled'
              : line.state === 'starting'
                ? 'loading'
                : 'error',
          ),
          ` ${line.text}`,
        ),
      );
    healthSection.append(ul);
  } else {
    healthSection.append(el('p', { class: 'pc-muted', text: 'Not checked yet.' }));
  }
  healthSection.append(
    el(
      'div',
      { class: 'pc-row' },
      button(
        'Check now',
        'pulse',
        false,
        s.buttons.health,
        () => {
          api.postMessage({ type: 'docker/health' });
        },
        'health',
      ),
    ),
  );
  app.append(healthSection);

  const logs = el('section', { class: 'pc-section' }, el('h2', { text: 'Output' }));
  const pre = el('pre', {
    class: 'pc-log pc-log--tall',
    text: logLines.join('\n') || 'Nothing yet.',
  });
  logs.append(pre);
  app.append(logs);
  // keep the newest line in view
  requestAnimationFrame(() => {
    pre.scrollTop = pre.scrollHeight;
  });
}

window.addEventListener('message', (ev: MessageEvent<HostToDocker>) => {
  const m = ev.data;
  if (m.type === 'docker/state') {
    state = m.state;
    if (busy === null) message = null;
  } else if (m.type === 'docker/busy') busy = m.busy ? (m.what ?? 'busy') : null;
  else if (m.type === 'docker/log') {
    logLines = m.lines;
    logging = m.logging;
  } else if (m.type === 'docker/health')
    health = { lines: m.lines, summary: m.summary, healthy: m.healthy, checking: m.checking };
  else message = { kind: 'error', text: m.message };
  render();
});

render();
api.postMessage({ type: 'docker/refresh' });
