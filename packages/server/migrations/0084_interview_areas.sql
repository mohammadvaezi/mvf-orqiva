-- ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
-- Why:  each interviewer question names the area it is about, so the answers raise that area's coverage
--       and the interviewer can be steered to the weakest area instead of stopping after six questions.

ALTER TABLE idea_messages
  ADD COLUMN area text CHECK (area IS NULL OR area IN ('problem', 'users', 'scope', 'non_goals', 'non_functional', 'data', 'integrations', 'security'));
