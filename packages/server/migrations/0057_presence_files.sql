-- ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
-- Why:  presence can go down to the code: which file someone has open in VS Code, so a colleague sees who
--       works on the same block (through its fingerprint). That is more than "who is on which task", so a
--       workspace decides it on its own, and it is off until an admin switches it on (works councils).
--       Guests never see files.
ALTER TABLE workspaces ADD COLUMN presence_files boolean NOT NULL DEFAULT false;
