<!-- [PCODE-335 | S15 | v0.1.0] T33.5 T33 exit check, docs and sprint close -->

# Trying, judging and paying for agents

**Agents** has a tab for each part of an agent's life: **Fleet**, **Settings**, **Runs and traces**,
**Playground**, **Evals**, **Costs** and **Quality**.

## Playground

Playground runs read what they need but never act. A change, a move or a comment is only recorded as
what the agent would have done. They cost what their tokens cost.

- **Rerun** on a run's trace runs it again in the playground, as it was or with another model, prompt
  version or temperature.
- **Compare**: tick two or three runs in **Runs and traces**. Their settings, status, tokens, cost, time
  and tools show side by side, with a line diff of their answers.
- **New experiment** runs one instruction with two to four variants, each up to five times. The table
  shows per variant what finished, what succeeded, and the cost, time and tokens of a run.

An agent that is still switched off can be tried in the playground.

## Evals

An eval set keeps the cases an agent should handle well. A case has an instruction, optionally a task,
what the answer must say and must not say, and the lowest judge score it may get.

**Run eval** runs every case in the playground, as the agent is or with another model, prompt version or
temperature. A case passes when its run succeeded, every check holds and the judge scored it high enough.
**Judge the cases** asks the judge for the scores still missing. The set's history shows the pass rate of
each eval run, so a change to the prompt or the model shows its effect.

**Save as eval case** under any run adds its instruction and task to one of the agent's sets.

## Quality

Under each trace:

- **Outcome**: what came of the run on its task. Its task was done after it, its pull request was merged,
  or a commit for it was reverted.
- **Judge**: the Reviewer agent scores the run from 1 to 5 against a fixed rubric, with a reason.
- **People**: anyone in the team marks a run good or bad, with tags (made things up, wrong tool, too costly
  …) and a note.

The **Quality** board shows per agent the good and bad marks, the judge's average and the outcomes.
Playground runs are left out.

## Traces

Each step keeps how long it took. Tool results and approvals sit under the model turn that asked for them,
with each tool's own time. A run lists the commits made for its task after it started, and the commits that
name it in an `Orqiva-Run:` trailer.

## Sandbox and the agents' Git identity

Give an agent the tools `read_repo_file`, `write_file` and `open_pull_request` to let it change code.

- `read_repo_file` reads the project's repository (GitHub or Gitea with an API token under
  **Repositories**). Once the run wrote a file, it reads the run's own version.
- `write_file` writes only into the run's sandbox, within the agent's file scope. Nothing reaches the
  repository yet.
- `open_pull_request` takes the changed files to a new branch `agent/<agent>-<run>` and opens a pull
  request. It is a push, which is never allowed until an admin allows it, or lets it ask first.

The commits are by the agent's bot identity, e.g. `Analyst agent (Orqiva)
<analyst@agents.orqiva.local>`, with the run in a trailer. Set the mail domain under the setting
**Mail domain of the agents' Git identity**. The trace shows the sandbox's files with their diff and the
pull request.

## MCP servers

**Settings → AI providers → MCP servers** keeps the outside MCP servers agents may use (Streamable HTTP).
Each server has:

- a name, used in the tool names;
- its address;
- a header for its key (sealed at once, never shown again);
- the kind of action of its tools: only reads, comments, writes or acts outside;
- optionally, the tools open to agents.

**Test** opens the server and lists its tools. Each agent picks its servers in its settings. In a run,
their tools appear as `mcp_<server>__<tool>`. The agent's autonomy and rules decide each call by the
server's kind of action, as for the agent's own tools. A server that cannot be reached is left out with a
note in the trace.

## Costs

- **Cache and reasoning**: cached input read and written and the reasoning share of the output are kept
  per step and per run, for every provider. Cache reads and writes use the model's cache prices, or a tenth
  and a quarter more of the input price when the price table has none. **Cache hits** shows the real share.
- **The euro rate**: the server reads the ECB's daily reference rate (a public file, nothing is sent; set
  `ORQIVA_FX=off` on a server without internet). Each run keeps the rate of its day, so its cost in euro
  stays what it was.
- **Estimate**: **Start a run** shows what the run will likely cost. The estimate comes from the agent's
  own finished runs, or is a rough figure from the instruction and the price, and says which.
- **Chargeback**: the month's AI cost per client or per cost centre (a project setting), downloadable as
  CSV.
- **Per task done**: the AI cost of the tasks finished this month and of the pull requests merged, counting
  each task's runs once.

## Limits and health

- **Runs an hour at most** (agent settings) holds an agent to a number of runs an hour. Further runs wait
  in the queue.
- A connection can have **calls a minute** and **tokens a minute** at most. A call waits for room instead of
  running into the provider's limit. The count is kept per server process.
- **AI providers** shows each connection's health from its real calls of today and yesterday: working,
  failing at times, down (its last call failed) or unused, with the number of calls, failures and the
  average time.
