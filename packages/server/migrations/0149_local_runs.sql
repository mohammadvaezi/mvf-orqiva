-- ── [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced ──
-- Why:  an AI run on a developer's machine (Claude Code in VS Code) is shown like a server run: it counts as
--       running, has a live step log and a result. The client opens it, adds the steps and closes it; the
--       server's worker never claims, re-queues or limits it.

ALTER TABLE agent_runs ADD COLUMN source text NOT NULL DEFAULT 'server' CHECK (source IN ('server', 'local'));
ALTER TABLE agent_runs ADD COLUMN client text NOT NULL DEFAULT '' CHECK (length(client) <= 200);
CREATE INDEX agent_runs_local_open ON agent_runs (requested_by, client) WHERE source = 'local' AND status = 'running';
