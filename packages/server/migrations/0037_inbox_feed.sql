-- ── [PCODE-162 | S15 | v0.1.0] B1.1 Live shell server: inbox, notification rules, settings inheritance, shell summary ──
-- Why:  notification rules replace the push preferences of PCODE-151: each person's choice per kind is
--       copied into every workspace they belong to (phone on or off, the inbox always on). The old table
--       stays readable until the next release and is no longer written.

INSERT INTO notification_rules (workspace_id, user_id, event_kind, channels)
SELECT m.workspace_id, p.user_id, k.kind,
       CASE WHEN k.wants THEN ARRAY['in_app', 'push'] ELSE ARRAY['in_app'] END
FROM push_preferences p
JOIN workspace_members m ON m.user_id = p.user_id
CROSS JOIN LATERAL (VALUES ('approvals', p.approvals), ('gates', p.gates), ('deploys', p.deploys), ('mentions', p.mentions)) AS k (kind, wants)
ON CONFLICT (workspace_id, user_id, event_kind) DO NOTHING;
