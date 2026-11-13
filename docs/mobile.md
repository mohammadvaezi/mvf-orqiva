<!-- [PCODE-238 | S15 | v0.1.0] T23.5 Communication exit check, docs and sprint close -->
<!-- [PCODE-227 | S15 | v0.1.0] T21.4 Mobile docs, end-to-end check and sprint close -->
<!-- [PCODE-231 | S15 | v0.1.0] T22.4 A day on the phone: exit test, docs and sprint close -->

# Orqiva on the phone

The Orqiva app for iOS and Android lets a manager follow the work from the phone: the live feed of a
workspace, the map of every project, the running sprint, and each task with its comments. People see each
other there, on the phone and in the web app. It keeps working without a network and catches up when the
network is back.

Built so far: the feed (T21); the map, sprints, tasks, comments and who is where (T22). Still to come:
approvals, push and lock-screen status for deploys, test and agent runs (T40), and the release in the App
Store and Google Play (T41). Both come after version 1.0 of Orqiva.

## Try it before the store release

Until T41, the app runs in Expo Go, Expo's free app from the App Store and Google Play.

What you need:

- a computer with Node.js 22 and this repository;
- a phone with Expo Go, on the same network as the computer;
- an Orqiva server the phone can reach.

```
cd packages/mobile
npm ci
npx expo start
```

Scan the QR code that `expo start` prints. On an iPhone, use the Camera app; on Android, use Expo Go. The
app opens in Expo Go. The Expo Go version must support Expo SDK 57.

A development build is a real app of its own, without Expo Go. It needs Android Studio
(`npx expo run:android`) or a Mac with Xcode (`npx expo run:ios`). The store builds come with T41.

## Sign in

The app never asks for a password. It signs in with a pairing code from the web app:

1. In the web app, open **Settings → Phone app** and choose **Show a pairing code**.
2. In the app, choose **Scan the code** and point the camera at it, or type the server and the code.
3. Check the server the app names, and confirm.

A code works once, for 10 minutes. The phone must reach the server by its network address or its name. A
phone cannot reach `localhost` on your computer. Outside a network you trust, use HTTPS: the app warns
about plain HTTP to an address outside the local network.

The app asks before it signs in to a server from a scanned code or a link, and names the server. Any web
page can open an `orqiva://` link, so a link alone never signs the phone in.

## The feed

- Newest first, with a heading for each day.
- The header shows **Live**, **Connecting…** or **Offline**.
- Pull down to ask the server again; this also reconnects at once.
- The feed shows what you may see in the web app. Guests cannot sign in on a phone yet.

## The map

The **Map** tab is the command center, sized for a phone:

- the open alerts first, the most serious at the top;
- one card for each project: its health (on track, at risk, critical) and why, the five risks as a strip
  (delivery, quality, security, operations, budget), the counts, and the tasks in progress with the
  person and the agents on them;
- the people in a project right now, with a green ring.

Tap a project for its sprint, or a task for the task.

## The sprint

A project opens on its running sprint: which day it is, the goal, the points done of those committed,
with a mark for today (the bar turns amber when the work is well behind the days), and every task by
state, with who has it and who is looking at it right now. Without a running sprint, it names the next
one.

## A task

- Where it stands: state, who has it, estimate, priority, due date.
- What done means: the acceptance criteria, and how many are ticked.
- The description, the comments, and the history.
- **Change State** and **Change Assignee** move the task or hand it on ("Me", anyone in the workspace, or
  nobody). A change sends only the field it changes, so it never overwrites what someone else edited
  meanwhile.
- Write a comment at the bottom. It shows in the web app at once, and comments written elsewhere show on
  the phone as they land.

A row in the feed about a task opens the task.

## Who is where

The phone tells the others where its person is (the workspace, a project or a task), the same way the web
app and VS Code do, and marks it as the phone. In the web app, someone on the phone has a small phone mark
on their avatar, and the text says "on the phone". On the phone, the people on a project or a task show
with a green ring ("Bob is editing"). When the app goes to the background, the phone stops reporting, and
it drops out after 45 seconds at most.

Every screen says when it was read ("Read at 10:42, updates live") and reads again shortly after
something changes it. Without a network it keeps showing what it read last, and says so.

## Without a network

The phone keeps the last 200 events. The app opens with them at once, even without a network, and says
when they were saved. Once the network is back, the server sends exactly the events the phone missed.
After a long absence, when there are too many to send, the app loads the newest page instead.

## Signing out, and what the phone keeps

- **On the phone:** tap your initials, then **Sign out of this phone**. This revokes the phone's token
  and deletes the session and the saved feed.
- **In the web app:** **Settings → Phone app** lists every phone signed in as you; **Sign out** stops
  that phone at once: its live connection ends, and the next time it asks the server, it is back at the
  sign-in.

Each phone has its own token: a personal token for one workspace, with the read and write scopes. It
runs out after the time the workspace's token policy allows (90 days by default). Then pair the phone
again.

The token is kept in the iPhone's Keychain or Android's Keystore, readable only on this device. The saved
feed lies in the app's own storage. That storage is not encrypted by the app itself, and it holds the
texts of the events, such as task titles. Encryption at rest and device management (MDM) for Enterprise
come with T41.

## For developers

- `packages/mobile` is a React Native app on Expo SDK 57. It has its own install and is not an npm
  workspace of the repository: React Native needs React 19.2.3, and the web app uses 19.3.0. Metro
  refuses any module that would come from the repository's root `node_modules`.
- The app uses `@orqiva/shared` through a link: the live client, the feed core with the offline cache,
  the pairing helpers and the event sentences are the same code as on the web and in VS Code.
- `npm ci --prefix packages/mobile` once. Then `npm run mobile` at the root type-checks the app, runs its
  tests and builds the bundles for Android and iOS. `npm run check` includes it, and the licence gate
  checks what the bundles hold and the native modules.
- `npm run export:web` in `packages/mobile` builds a browser preview, for screenshots. A browser cannot
  send the token on a socket, so the preview needs a proxy that adds it.

## The exit tests on test devices

These tests run on real phones.

### T21: the live feed on iOS and Android

It proves the T21 exit: the live feed on iOS and Android test devices.

1. Use a server the phones can reach, with HTTPS if possible.
2. Install Expo Go on one iPhone and one Android phone, run `npx expo start` in `packages/mobile`, and
   open the app on both.
3. Pair each phone with its own code. Both phones show up under **Settings → Phone app**.
4. Change a task in the web app. Within a second, both phones show it, and both say **Live**.
5. Put one phone in airplane mode, and change two tasks. Open the app: the saved feed shows, with the
   offline banner. Turn airplane mode off: the two changes arrive, each once.
6. Sign that phone out in the web app, then pull down on the phone. The app is back at the sign-in and
   says the phone was signed out.

Note the phone models and system versions in the T21 review.

### T22: a manager follows a sprint from the phone only, for one day

`packages/server/test/db/phoneday.test.ts` runs this day against the server with the calls the app makes.
On real phones:

1. The manager pairs a phone, signs out of the web app on the computer, and uses only the phone that day.
2. In the morning, on the map: the project, its health and the tasks in progress. On the sprint: the day,
   the points done, the tasks by state.
3. During the day the team works as usual in the web app and VS Code. The manager reads each change on
   the feed as it happens, opens tasks from it, answers questions in the comments, moves a task, and hands
   one to someone else.
4. When the manager is on a task, the team sees them there with the phone mark, and the manager sees who
   is on it.
5. In the evening, the sprint on the phone matches the web app's.

Note anything the manager had to go back to the computer for.
