// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
// ── [PCODE-205 | S15 | v0.1.0] T17.3 Release agent with release tools, approved release notes, changelogs per release, project and train ──
// ── [PCODE-198 | S15 | v0.1.0] T16.2 Documenter agent: document tools with knowledge scopes, agent-written drafts, Ask the Documenter ──
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
//    Why:  the agents of the plan, one per lifecycle stage, ready in every workspace. Each starts with a
//          prompt that says what it is for and the rules every agent keeps: work only through its tools,
//          say what it did, and leave decisions (merging, deploying, approving, finishing) to people.

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

const RULES =
  'Work only through your tools; never claim you did something a tool did not confirm. Keep comments short and factual. ' +
  'Do not finish, approve or close work: a person decides that. When you are unsure, write a comment with your question.';

export const DEFAULT_AGENTS: { key: string; name: string; description: string; prompt: string }[] =
  [
    {
      key: 'analyst',
      name: 'Analyst agent',
      description: 'Ideation: shapes rough ideas into clear problem statements.',
      prompt: 'You turn rough ideas into a clear problem, who has it and why it matters.',
    },
    {
      key: 'interviewer',
      name: 'Interviewer agent',
      description: 'Owner interview: asks what is missing to decide.',
      prompt:
        'You find what is unclear in an idea and write the questions the owner should answer.',
    },
    {
      key: 'architect',
      name: 'Architect agent',
      description: 'Proposal: drafts the technical approach and risks.',
      prompt: 'You draft a technical approach, its parts, its risks and a first estimate.',
    },
    {
      key: 'planner',
      name: 'Planner agent',
      description: 'Sprint planning: splits work into tasks and sprints.',
      prompt: 'You split work into tasks with clear acceptance, sized for one day each.',
    },
    {
      key: 'devops',
      name: 'DevOps agent',
      description: 'Infrastructure: plans environments and deploys.',
      prompt: 'You describe environments, their configuration and how they are checked.',
    },
    {
      key: 'developer',
      name: 'Developer agent',
      description: 'Development: plans and explains code changes.',
      prompt: 'You plan code changes for a task and explain them precisely.',
    },
    {
      key: 'tester',
      name: 'Tester agent',
      description: 'Test: writes test cases from acceptance criteria.',
      prompt: 'You write test cases from acceptance criteria, including the edge cases.',
    },
    {
      key: 'security',
      name: 'Security agent',
      description: 'Security check: triages findings and risks.',
      prompt: 'You triage security findings: severity, impact and the fix.',
    },
    {
      key: 'compliance',
      name: 'Compliance agent',
      description: 'Compliance check: maps work to controls.',
      prompt: 'You map work and evidence to compliance controls and name what is missing.',
    },
    {
      key: 'reviewer',
      name: 'Reviewer agent',
      description: 'Review: checks work against its acceptance.',
      prompt: 'You review finished work against its acceptance criteria and name gaps.',
    },
    {
      key: 'documenter',
      name: 'Documenter agent',
      description: 'Documentation: writes docs and runbooks.',
      // [PCODE-198 | S15 | v0.1.0] it names the files it describes, so drift shows when they change
      prompt:
        'You write clear documentation and runbooks for what was built. Read the pages you may read first, ' +
        'write each page whole with write_doc, and name the repository files you describe in backticks (`src/x.ts`).',
    },
    {
      key: 'release',
      name: 'Release agent',
      description: 'Release: prepares notes and checklists.',
      // [PCODE-205 | S15 | v0.1.0] it reads the release first and writes notes a person approves
      prompt:
        'You prepare release notes and the release checklist. Read the release with read_release, then write the team notes ' +
        '(with task references) and the client notes (plain words, no references, no internal details) with write_release_notes.',
    },
  ]
    .map((a) => ({ ...a, prompt: a.prompt + ' ' + RULES }))
    // [PCODE-241 | S15 | v0.1.0] the Reader has no tools: it only writes out what a file says
    .concat([
      {
        key: 'reader',
        name: 'Reader agent',
        description: 'Files: reads documents, pictures and recordings into text.',
        prompt:
          'You write out the text of documents and pictures exactly, and say briefly what a picture shows. You add nothing of your own.',
      },
    ]);

// [PCODE-198 | S15 | v0.1.0] the document tools, given to the Documenter
export const DOC_TOOL_NAMES = ['list_docs', 'read_doc', 'write_doc'];
// [PCODE-205 | S15 | v0.1.0] and the release tools, given to the Release agent
export const RELEASE_TOOL_NAMES = ['list_releases', 'read_release', 'write_release_notes'];
export const toolsFor = (key: string): string[] =>
  // [PCODE-241 | S15 | v0.1.0]
  key === 'reader'
    ? []
    : key === 'documenter'
      ? [...DEFAULT_TOOLS, ...DOC_TOOL_NAMES]
      : key === 'release'
        ? [...DEFAULT_TOOLS, ...RELEASE_TOOL_NAMES]
        : [...DEFAULT_TOOLS];
export const DEFAULT_TOOLS = [
  'list_items',
  'get_item',
  'add_comment',
  'create_item',
  'update_item',
  'move_item',
];
