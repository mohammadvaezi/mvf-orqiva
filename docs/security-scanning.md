<!-- [PCODE-326 | S15 | v0.1.0] T32.9 T32 exit check, docs and sprint close -->

# Security scanning

The project's **Security** tab collects the findings of every scanner and ranks them by risk. It also tracks
what has shipped and helps fix it.

## Getting findings in

- `orq scan` in the repository checks the files Git tracks for secrets and risky code.
- `orq scan --deps` adds the dependencies, checked against the OSV database.
- `orq scan --history` checks the last 2000 commits for secrets (`--history-depth N` for more). A secret
  removed from the files stays in every clone, so the finding asks to rotate it. Exceptions written down in
  `.orqiva/scan-ignore`, or on the line itself, apply here too.
- **Upload SARIF** in **Findings** takes the results of any scanner that writes SARIF, such as CodeQL,
  Semgrep or Trivy. The upload counts as a full scan of that tool: what it no longer reports is marked fixed.

A dependency finding carries its CVE, package, version and fixed version as data. The CLI writes them, and
any tool can send them in a SARIF result's properties.

## Leaks

Secrets also turn up where nobody meant to keep them. Commit messages that reach Orqiva by webhook, deploy
logs and what an agent saw are all scanned:

- an Orqiva token found there is revoked at once;
- another service's key becomes a finding of the project, named by its kind and where it was found, never
  by its value.

Logs and commit messages are stored with the secret replaced by its kind.

## Priority

A finding's risk combines its severity with its CVSS, its EPSS score, whether it is known to be exploited,
and whether it is reachable or exposed.

**Vulnerability feeds** fill in EPSS (FIRST) and the known-exploited list (CISA) once a day. An admin
switches them on in the workspace settings, since EPSS is sent the CVE ids of your findings.

When an open CVE sits in a package version that a shipped version's SBOM lists, the project's leads and the
admins get a **Security** alert. They get another when that CVE becomes known to be exploited.

## Per version

**Versions** shows each release's open vulnerabilities, from its SBOM, and a score. For each vulnerability,
say whether the version is affected:

- **not affected**, and why (the OpenVEX reasons);
- **affected**, and what to do;
- **fixed**;
- **under investigation**.

"Not affected" and "fixed" set the vulnerability aside in the version's posture. **Download OpenVEX**
gives the statements to customers and their tools.

## Fixing

- **Open an upgrade pull request** on a dependency finding raises the package in `package.json` (keeping
  its `^` or `~`, or adding an npm override when it only comes in through another package). In
  `requirements.txt` it raises the pin. Run the install so the lockfile follows.
- **Open a fix pull request** on a code finding gives the file to the Security agent. The corrected file
  it answers with becomes the pull request; review it like any other change.
- Secrets are not fixed by a pull request: rotate them.

Both need a GitHub or Gitea repository with an API token (**Repositories**). The finding moves to _fixing_
and keeps the link.

## Policies

**Policies and campaigns** set what stops a merge or a release:

- a severity or risk at or above a level;
- secrets in the code;
- banned licences;
- for releases: every test passing and a signed-off test run.

An admin can let a release go anyway with a reason.
