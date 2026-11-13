<!-- [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names -->
<!-- [PCODE-64 | S12 | v0.1.0] Add the Get Started walkthrough content and smoke checklist for Sprint 12 -->

# Sign in to Orqiva

Three things: the address of your Orqiva server (for example `http://orqiva.your-company.lan:8080`), your
e-mail and your password.

The password is not stored. The server hands this computer a personal token, kept in
`~/.orqiva/credentials.json` and readable by you only. It is the same sign-in `orq login` makes, so the
`orq` command, the Claude Code hooks and the extension all use it.

No account yet? Ask your Orqiva admin for an invitation link, and choose your password there.

This step completes once you are signed in.
