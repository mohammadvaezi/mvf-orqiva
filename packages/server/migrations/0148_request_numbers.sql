-- ── [PCODE-428 | S15 | v0.1.0] T37 low: Request references count per kind ──
-- Why:  every kind of request counts on its own (BUG-1, BUG-2, F-1 …) instead of one counter shared by
--       all kinds (F-1, then BUG-2 and no BUG-1). Requests made before keep their numbers.

ALTER TABLE client_requests DROP CONSTRAINT client_requests_client_id_number_key;
ALTER TABLE client_requests ADD CONSTRAINT client_requests_client_kind_number UNIQUE (client_id, kind, number);
