<!-- [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names -->

# Fix for the VS Code extension (V1 test)

This folder replaces the Orqiva extension of the V1 test build with a fixed one. It fixes two problems
found on a developer PC:

- **Your project, step 3**: the Home tab offered _Start a new project_ and _Use an existing project_,
  but did not show the project you had just made in the Orqiva web app. A new project made there did not
  appear in Orqiva either. The extension still used the old tracker for these steps.
- **The old name**: the Home tab and the sidebar still showed the old tracker's name at "Connect …".
  Every screen now says Orqiva.

With the fixed extension, VS Code uses the same sign-in as the `orq` command. _Use an existing project_
lists the projects from your Orqiva server, and _Start a new project_ creates the project on the server.

It also fixes two later findings: the Orqiva tab now shows which project and server the folder uses and
lets you change them, and planning (describe, plan with Claude, publish) works on the Orqiva server.

The third problem, **File, Edit, Selection and the other menus not responding**, is covered in step 5.

## What is in the folder

| File                 | What it is                                                           |
| -------------------- | -------------------------------------------------------------------- |
| `Fix-OrqivaIDE.cmd`  | double-click this: it runs the fix                                   |
| `Fix-OrqivaIDE.ps1`  | the fix itself, which the `.cmd` runs                                |
| `orqiva-0.1.0.vsix`  | the fixed VS Code extension                                          |
| `orq.mjs`            | the `orq` command, updated: the Claude Code hooks run it             |
| `FIX-GUIDE.html/.md` | this guide                                                           |
| `SHA256SUMS`         | the checksum of every file, to check that nothing changed on the way |

You do not need to run the setup program again. Your sign-in stays as it is; the `orq` command is
replaced by the new one (the old one is kept as `orq.mjs.before-fix`).

## Step 1: close VS Code

Save your work and close **every** VS Code window. While VS Code runs, it keeps the old extension
loaded.

## Step 2: run the fix

1. Copy this folder to the PC, for example to the desktop.
2. Double-click **`Fix-OrqivaIDE.cmd`**.
   - Windows may show "Windows protected your PC", because the script is not signed. Choose **More
     info → Run anyway**.
   - It needs no administrator rights.
3. The window goes through six checks. Each line starts with `OK` or `NOTE`:
   1. **Close VS Code**: it waits until VS Code is closed.
   2. **Replace the Orqiva extension**: it removes the old extension and installs the fixed one. The line
      `Installed broszio.orqiva@0.1.0` says it worked.
   3. **Update the orq command**: it puts the new `orq` in `%LOCALAPPDATA%Orqivain`.
   4. **Sign-in to your Orqiva server**: it shows the server you are signed in to, for example
      `Signed in to http://195.167.221.229:8490 as you@company`. If you are not signed in, answer `y`,
      then type the server address and your e-mail. `orq` asks for your password and does not show it.
   5. **Link a project folder**: optional. Press Enter to skip it; VS Code can do it in step 4.
   6. **VS Code menu bar**: it reports the settings that hide the menus. See step 5.
4. Press any key to close the window.

### Without the .cmd (by hand)

In VS Code: **Extensions** (Ctrl+Shift+X) → the **…** menu at the top → **Install from VSIX…** → pick
`orqiva-0.1.0.vsix`. Then choose **Developer: Reload Window** from the command palette (Ctrl+Shift+P).

## Step 3: check that the fixed extension is running

1. Open VS Code.
2. Open the command palette (**Ctrl+Shift+P**) and type `Orqiva: Sign in`. If **Orqiva: Sign in to the
   Orqiva server** is in the list, the fixed extension is running.
3. The **Orqiva** tab opens by itself. The four steps at the top read **This computer → Sign in to
   Orqiva → Your project → Work**. If step 2 still says "Connect …" instead, the old extension is still loaded:
   close every VS Code window and open VS Code again.

## Step 4: connect your project folder

1. Open your project folder: **File → Open Folder…**, or drag the folder onto the VS Code window.
2. On the Orqiva tab:
   - **Step 2, Sign in to Orqiva**, is ticked if you are signed in. If it is not, click **Sign in** and
     type the server address (`http://195.167.221.229:8490`), your e-mail and your password.
   - **Step 3, Your project**: click **Use an existing project**. A list shows the projects on the
     server, for example **MARK – Marketspider**. Pick yours.
3. A message says `Linked MARK Marketspider (Orqiva).` The folder now has `.orqiva/project.json`, and
   the Orqiva tab shows the project's board.

To make a new project instead, click **Start a new project**. Give it a name and a short key (two to
five capital letters, for example `SHOP`). Orqiva creates it on the server and links the folder. It
then appears in the web app under **Projects**.

The same works from a terminal in the folder: `orq link MARK`.

<!-- [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server -->

### Change the project, the server or the account

The project's name and server are at the top right of the Orqiva tab. Click a finished step to see what
it set up and to change it:

- **Your project** (or the project's name at the top right): the linked project and its server, with
  **Link to another project**, **Start a new project** and **Open in Orqiva**.
- **Sign in to Orqiva**: the server and the account, with **Sign in to another server or account**.
- **Back to my project** returns to the board.

<!-- [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself -->

### Plan the project with Claude

On a project without tasks, the Orqiva tab plans it with you. Once this computer, the sign-in and the
project are set up, they shrink to one line at the top (**Setup**); click one to see or change it. Below
it, **Plan your project** shows where you are, step by step:

1. **Describe your idea**: write what you want built, then **Save - Claude reads it next**.
2. **Answer Claude's questions**: Claude reads the description and asks what it needs to know (who uses
   it, what is a must, which systems it connects to, where it runs). Each question is a card: answer in
   your own words, click a suggested answer, or **Attach files** (a spec, a sketch, a CSV export). Leave
   one empty and Claude decides it. **Send my answers**, and Claude reads them; it may ask a second
   round. **Skip the questions and write the plan** lets Claude decide the rest.
3. **Claude writes the plan**: when nothing is unclear, the tab shows what Claude understood. **Write
   the plan**, or **Add something first**. While Claude works, the tab shows what it does; **Stop**
   ends it. No terminal is needed.
4. **Check and publish**: look the plan over, then **Publish the plan**. **Plan it again** asks what
   should change; Claude may ask again, then writes a new plan (the old one is kept in
   `.orqiva/state/plan.previous.json`). **Change the description** opens your text; when you save a
   change, Claude reads it again before it plans anew.

The questions and answers are kept in `.orqiva/description/conversation.md`, the files in
`.orqiva/description/attachments/`. Closing VS Code half-way loses nothing.

<!-- [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced -->

### What the portal shows while you plan

- **The run, live.** While Claude plans, the portal counts it in **N laufen** at the top. Under
  **Agenten**, the run of the **Planner agent** shows each step as it happens: which files Claude reads
  and writes, the commands it runs, and when it asks you questions in VS Code. When the plan is written,
  the run ends with its result, for example `Plan written: 27 sprints, 113 tasks`.
- **The documents.** Under **Dokumente**, the folder **Project plan** holds the description, the
  architecture, design system, criticals and rules, and the sprint plan. They are updated when you save
  the description, when Claude has written the plan and when you publish; **Planning conversation**
  holds Claude's questions and your answers. A page someone changed in
  the portal is not overwritten; the Orqiva output in VS Code (View → Output → Orqiva) names it.
- **The tasks.** After **Publish the plan**, the sprints and tasks are on the board and under **Planung**.

The live run needs the updated Orqiva server (see the server notes you got with this fix). With an older
server, the documents and the tasks still arrive; only the live run is missing.

## Step 5: the menus (File, Edit, Selection …)

Nothing in the Orqiva extension changes or blocks the VS Code menus: it adds no keyboard shortcuts and
changes no settings. Check these three things, in this order:

1. **The menu bar setting.** The fix script reports `window.menuBarVisibility`. If it is `hidden`,
   `toggle` or `compact`, VS Code hides or folds the menus. The script offers to set it back to
   `classic` and keeps a backup of your settings. You can also change it by hand: **Ctrl+,** → search
   `menu bar visibility` → choose **classic**.
2. **A dialog behind the window.** VS Code stops answering clicks on its menus while a dialog is open
   behind its window. Press **Alt+Tab** and look for a small VS Code or Windows dialog; answer or close it.
3. **Is it the extension?** Close VS Code. Press **Win+R**, type `code --disable-extensions` and press
   Enter. VS Code opens with every extension switched off.
   - **The menus work now**: an extension causes it. In the normal VS Code, switch the extensions off
     one at a time (Extensions → the gear → **Disable**) to find which one. If it is Orqiva, report it
     as described below.
   - **The menus still do not work**: VS Code itself or Windows causes it, not an extension. Update VS Code
     (**Help → Check for Updates**, or `winget upgrade Microsoft.VisualStudioCode`) and restart the PC.

## If something does not work

File a bug in the `FB` project on the Orqiva server. Add the window's text from step 2 and a screenshot
of the Orqiva tab. In VS Code, **View → Output**, then pick **Orqiva** in the list on the right: copy
those lines into the bug as well.
