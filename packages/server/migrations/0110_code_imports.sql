-- ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
-- Why:  the code scan also sends what each file imports from the repository itself (outside packages left
--       out), so the code map can draw which folders depend on which. Null: the scan did not say.

ALTER TABLE code_files ADD COLUMN imports text[] CHECK (imports IS NULL OR cardinality(imports) <= 500);
