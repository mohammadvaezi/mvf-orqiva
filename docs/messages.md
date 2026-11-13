<!-- [PCODE-238 | S15 | v0.1.0] T23.5 Communication exit check, docs and sprint close -->

# Messages

Your team and your clients talk inside Orqiva: in channels, in direct messages and in threads, next to
the work they talk about. Nothing needs Slack or Teams. A connection to Slack comes later as an extra
feature, but you never depend on it.

## Channels

Every workspace starts with **#general**. Anyone in the team opens more with **+** next to _Channels_ in Messages:

- **Workspace channel**: open to every member, who joins it with one click.
- **Project channel**: for one project. Anyone who sees the project may join it.
- **Client channel**: shared with a client's contacts. They are in it at once, and every contact
  invited later joins it too. A client sees nothing else in Messages: no other channel, nobody's direct
  messages, and no search results outside their channels.
- **Private channel**: only the people in it see it. They add the others.

A channel can be muted. You still see it, but its unread messages are not counted on the Messages
badge. Mentions of you still count.

## Direct messages

With **+** next to _Direct messages_, write to one person or to a small group. Clients cannot open direct
messages. They talk to the team in their client channel.

## Writing

- **Mention** someone with `@` and the start of their address: `@ada` reaches whoever's address starts
  with `ada@`. The person mentioned gets a notice in their inbox, on their phone and, if they chose it,
  by mail.
- **Reply in a thread** to keep a topic together. The channel shows the first message with the number
  of replies.
- **Task references** such as `HEL-12` become links to the task.
- **Files** are attached with the paper clip next to the message box.
- **Reactions**: 👍 👀 ✅ 🎉 ❤️ 😄 🙏 🚀 ⚠️ ❓.
- **Edit** your own messages. **Delete** your own, or any message as an admin. A deleted message keeps
  its place in the thread, without its text and files.

## From a message to a task

Point at a message and choose **Make a task** in its actions. Pick the project and correct the title. The task
links back to the message, and the message shows the task. This is how a client's report becomes work
on the board without being copied.

## Finding things

The search in Messages looks through every conversation you can see. Unread messages are counted per
conversation and on the Messages badge in the left rail.

## In VS Code and in the terminal

The Orqiva extension has a **Messages** view. It lists your conversations, those with something new
first, and opens a conversation in an editor tab to read and write.

In the terminal:

```
orq msg                                   # your conversations, the ones with something new first
orq msg #release-planning --last 20       # the latest messages of a channel
orq msg @bob "Can you look at HEL-12?"     # a direct message to Bob
orq msg #helio "Fixed." --thread <ID>     # reply in a thread
```

A message written without a network waits in orq's queue and goes out when the server is reachable.

## What Messages does not do

Conversations are not part of the activity feed, the audit of tasks or the exports of a project. They
belong to the people who wrote them and to those who can see the channel.
