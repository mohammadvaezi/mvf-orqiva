-- ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
-- Why:  public facts about CVEs, kept once for the server: the EPSS score and percentile, and whether CISA
--       lists it as exploited (when added, the due date, ransomware use). Not a workspace's data, so no row
--       security; the server writes it, every workspace reads it. A finding remembers when its shipped
--       versions were alerted, and when its being exploited was.

CREATE TABLE cve_facts (
  cve             text PRIMARY KEY CHECK (cve ~ '^CVE-[0-9]{4}-[0-9]{4,}$'),
  epss            real CHECK (epss BETWEEN 0 AND 1),
  epss_percentile real CHECK (epss_percentile BETWEEN 0 AND 1),
  kev             boolean NOT NULL DEFAULT false,
  kev_added       date,
  kev_due         date,
  ransomware      boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON cve_facts TO prodengine_app;

ALTER TABLE findings
  ADD COLUMN shipped_alerted_at timestamptz,
  ADD COLUMN kev_alerted_at     timestamptz;

ALTER TABLE inbox_items DROP CONSTRAINT inbox_items_kind_check;
ALTER TABLE inbox_items ADD CONSTRAINT inbox_items_kind_check
  CHECK (kind IN ('approval', 'review', 'mention', 'question', 'signoff', 'request', 'test', 'incident', 'message',
                  'budget', 'watch', 'reminder', 'security'));
