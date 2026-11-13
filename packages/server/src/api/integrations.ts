// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
//    Why:  one page that says what this workspace is connected to and where each connection is set up:
//          Git hosts and CI, monitoring, design, agents' tools and models, billing, sign-in, mail, calendar
//          and chat bridges. The state comes from what is configured, never from a separate switch.
import type { Pool, PoolClient } from 'pg';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';

const uuid = s.string({ format: 'uuid' });

export interface Integration {
  key: string;
  name: string;
  group: 'Code' | 'Operations' | 'Design' | 'Agents' | 'Workspace' | 'Communication';
  state: 'connected' | 'off' | 'built-in';
  detail: string;
  where: string | null;
}

const count = async (c: PoolClient, sql: string): Promise<number> =>
  Number((await c.query<{ n: string }>(sql)).rows[0]?.n ?? 0);

const plural = (n: number, one: string, many: string): string =>
  String(n) + ' ' + (n === 1 ? one : many);

/** What the workspace is connected to, from what is configured. */
export async function integrationsOf(c: PoolClient, mail: boolean): Promise<Integration[]> {
  const git = await count(c, 'SELECT count(*) AS n FROM git_connections');
  const ci =
    (await count(
      c,
      "SELECT count(*) AS n FROM test_runs WHERE source <> 'manual' AND started_at > now() - interval '30 days'",
    )) +
    (await count(
      c,
      "SELECT count(*) AS n FROM ci_runs WHERE started_at > now() - interval '30 days'",
    )); // [PCODE-349 | S15 | v0.1.0]
  const alerts = await count(c, 'SELECT count(*) AS n FROM alert_sources');
  const figma = await count(c, 'SELECT count(*) AS n FROM figma_links');
  const mcp = await count(c, 'SELECT count(*) AS n FROM mcp_servers');
  const ai = await count(c, 'SELECT count(*) AS n FROM ai_connections');
  const billing = await count(c, 'SELECT count(*) AS n FROM billing_accounts');
  const saml = await count(c, 'SELECT count(*) AS n FROM saml_connections');
  const hooks = await count(c, 'SELECT count(*) AS n FROM webhooks WHERE active');
  const inbound = (await c.query<{ domain: string }>('SELECT domain FROM email_inbound')).rows[0];
  // [PCODE-349 | S15 | v0.1.0] bridges and calendar links
  const slack = await count(c, "SELECT count(*) AS n FROM chat_bridges WHERE kind = 'slack'");
  const teams = await count(c, "SELECT count(*) AS n FROM chat_bridges WHERE kind = 'teams'");
  const feeds = await count(c, 'SELECT count(*) AS n FROM calendar_feeds');
  const on = (n: number): 'connected' | 'off' => (n ? 'connected' : 'off');
  return [
    {
      key: 'git',
      name: 'GitHub, GitLab and Gitea',
      group: 'Code',
      state: on(git),
      detail: git
        ? plural(git, 'repository connection', 'repository connections')
        : 'Connect a repository in a project’s Repositories tab',
      where: '/projects',
    },
    {
      key: 'ci',
      name: 'CI results',
      group: 'Code',
      state: on(ci),
      detail: ci
        ? plural(ci, 'run reported by CI', 'runs reported by CI') + ' in 30 days'
        : 'Pipelines report their runs and test results through the API',
      where: '/projects',
    },
    {
      key: 'alerts',
      name: 'Sentry and Alertmanager',
      group: 'Operations',
      state: on(alerts),
      detail: alerts
        ? plural(alerts, 'alert source', 'alert sources')
        : 'Add an alert source under Incidents',
      where: '/incidents?view=sources',
    },
    {
      key: 'webhooks',
      name: 'Outgoing webhooks',
      group: 'Operations',
      state: on(hooks),
      detail: hooks
        ? plural(hooks, 'webhook', 'webhooks') + ' active'
        : 'Send activity to your own systems from Activity',
      where: '/activity',
    },
    {
      key: 'figma',
      name: 'Figma',
      group: 'Design',
      state: on(figma),
      detail: figma
        ? plural(figma, 'linked file', 'linked files')
        : 'Link a Figma file in a project’s UI kit',
      where: '/projects',
    },
    {
      key: 'ai',
      name: 'AI providers',
      group: 'Agents',
      state: on(ai),
      detail: ai
        ? plural(ai, 'connection', 'connections')
        : 'Agents run on the demo model until a provider is added',
      where: '/settings/ai',
    },
    {
      key: 'mcp',
      name: 'MCP servers',
      group: 'Agents',
      state: on(mcp),
      detail: mcp ? plural(mcp, 'server', 'servers') + ' for agents' : 'Give agents outside tools',
      where: '/agents',
    },
    {
      key: 'billing',
      name: 'Stripe',
      group: 'Workspace',
      state: on(billing),
      detail: billing ? 'Billing account connected' : 'Plan and invoices through Stripe',
      where: '/settings/billing',
    },
    {
      key: 'sso',
      name: 'SAML single sign-on and SCIM',
      group: 'Workspace',
      state: on(saml),
      detail: saml
        ? 'Sign-in through your identity provider'
        : 'Sign in through Okta, Entra ID or another SAML provider',
      where: '/settings/identity',
    },
    {
      key: 'mail',
      name: 'Mail out',
      group: 'Communication',
      state: mail ? 'connected' : 'off',
      detail: mail
        ? 'The server sends mail'
        : 'Set ORQIVA_SMTP_HOST and ORQIVA_MAIL_FROM on the server',
      where: null,
    },
    {
      key: 'email-in',
      name: 'Email in',
      group: 'Communication',
      state: inbound ? 'connected' : 'off',
      detail: inbound
        ? 'Replies and ideas arrive at ' + inbound.domain
        : 'Answer notices and send ideas by mail',
      where: '/settings/integrations#email-in',
    },
    {
      key: 'calendar',
      name: 'Calendar',
      group: 'Communication',
      state: feeds ? 'connected' : 'built-in',
      detail: feeds
        ? plural(feeds, 'person reads', 'people read') + ' their dates in their calendar'
        : 'Everyone can add their dates to Google Calendar or Outlook',
      where: '/settings/integrations#calendar',
    },
    // [PCODE-349 | S15 | v0.1.0] the optional chat bridges
    {
      key: 'slack',
      name: 'Slack',
      group: 'Communication',
      state: on(slack),
      detail: slack
        ? plural(slack, 'bridge', 'bridges')
        : 'Optional: post incidents, releases, deploys and CI failures to a Slack channel',
      where: '/settings/integrations#bridges',
    },
    {
      key: 'teams',
      name: 'Microsoft Teams',
      group: 'Communication',
      state: on(teams),
      detail: teams
        ? plural(teams, 'bridge', 'bridges')
        : 'Optional: post the same to a Teams channel through a workflow',
      where: '/settings/integrations#bridges',
    },
  ];
}

export function integrationRoutes(pool: Pool, deps: { mail?: boolean } = {}): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/integrations',
    summary: 'What the workspace is connected to and where each connection is set up (admin)',
    tags: ['integrations'],
    params: s.object({ workspaceId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: { integrations: await integrationsOf(c, deps.mail ?? false) },
      })),
  });
  return [list];
}
