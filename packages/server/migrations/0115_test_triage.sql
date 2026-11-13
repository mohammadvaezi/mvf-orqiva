-- ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
-- Why:  the Tester agent's view of a failed or blocked result, kept with it:
--       { "category": "product_bug|test_bug|environment|flaky", "confidence": 0.8, "reason": "...",
--         "next": "...", "runId": "<agent run>", "at": "..." }

ALTER TABLE test_results ADD COLUMN triage jsonb;
