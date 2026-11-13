-- ── [PCODE-294 | S15 | v0.1.0] T30.8a Overlay compare of mockup versions, client pins in the portal ──
-- Why:  a client contact pins comments to a design shared with them; the team sees which pins are theirs.

ALTER TABLE mockup_pins ADD COLUMN from_client boolean NOT NULL DEFAULT false;
