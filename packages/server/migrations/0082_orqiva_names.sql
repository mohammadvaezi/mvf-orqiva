-- ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
-- Why:  lifecycles started before the rename still showed "ProdEngine default"; the default is called
--       "Orqiva default" now, in running projects and in templates of that name alike.

-- the tables are row-level secured: this runs for every workspace
SELECT set_config('app.system', 'on', true);

UPDATE project_lifecycles SET template_name = 'Orqiva default' WHERE template_name = 'ProdEngine default';
UPDATE lifecycle_templates SET name = 'Orqiva default'
 WHERE name = 'ProdEngine default'
   AND NOT EXISTS (SELECT 1 FROM lifecycle_templates t2 WHERE t2.workspace_id = lifecycle_templates.workspace_id AND t2.name = 'Orqiva default');
