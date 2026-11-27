---
name: kiss-review
description: Unattended critical review of the dashql codebase: read-only reviewers per area hunt needless complexity, dead code and bugs, then fix agents in waves land the clear fixes on main and leave the owner a morning report. Use when the user runs /kiss-review [scope], e.g. /kiss-review, /kiss-review packages/dashql-core-runtime, /kiss-review "since 3 days ago".
---

# KISS review run

The owner wants the code to stay simple and stupid. Fast feature work leaves behind abstractions with one caller,
duplicated logic, half-dead machinery, band-aids in tests and docs that describe removed code. This run finds and
removes them. It reviews the code as it is, not only what changed: old code that grew complicated counts as much as
a new commit. It runs overnight without the owner: decide what is clear, defer what is the owner's call, never push.

Argument, the scope:
- none (the default): the areas reviewed longest ago or never, about 6 of them, see "Choosing the areas";
- paths or area names (`packages/dashql-core-runtime`, "the formatter"): just those;
- "since <date or commit>": the code that the commits since then touched, read as whole files and modules, not as
  diffs.

Note the commit of `main` at the start as `START` and keep it fixed for the run.

`bazel-gov.sh <command> [args...]` of this skill (call it by absolute path from the main checkout,
`.claude/skills/kiss-review/`) is the only way agents run Bazel. It allows up to 3 runs machine-wide and one browser
suite, waits while load or memory is high, and caps each run. Plain `bazel build/test` is forbidden: parallel agents
ran the 23 GB VM out of memory before.

Other sessions edit the main checkout concurrently: never stash, reset or stage in it.

## Owner's principles (the yardstick for every finding and fix)

- Delete machinery rather than add it. No speculative generality, one way of doing a thing.
- Logic that fits the core is Rust in the core (`docs/agents/core_first.md`). Components show models, hooks bind the
  runtime (`docs/agents/writing_components.md`).
- Derived graphs reuse the analyzer and planner, never ad hoc name matching. New core outputs get snapshot tests.
- Perf work stays simple: delete work instead of adding caches, queues or hooks.
- The AST stays fully typed (enums over bools and strings).
- Simple formats: plain JSON, no sidecars, uniform names. Explicit params, not env vars or detection.
- Never drop storage migration steps: that complexity is intended.
- Docs describe current behavior only, no history. Code: `//` comments, `.js` in TS relative imports, multiline
  template literals for line-broken text, npm scope `@akohn`.

## Phase 1: review (read-only, parallel)

### Choosing the areas

The codebase splits along its seams into areas of a size one reviewer can read in a night, roughly 5–15k lines of
code without tests and snapshots (`git ls-files <paths> | xargs wc -l`). The areas, as of 2026-11:
- core: formatter, `tools/sql_format`;
- core: analyzer, catalog, name resolution;
- core: completion, vis tags, visualize, script diff;
- parser, grammar, scanner;
- core bindings, flatbuffers (`proto/fb`);
- Rust runtime: workbook runs, planner, executor;
- Rust runtime: compute, connections, storage, profile, dataflow;
- the `dashql` command, `dashql-native` (desktop app, agent harness);
- TS runtime `packages/dashql` (runtime, platform, storage);
- app: workbook feed, dashboard, editor, prompt;
- app: navigation, connections, shell, settings, tools, host, agent;
- `dashql-react` (data table, visualization, building blocks);
- extensions (`extensions/`), client functions;
- website and docs (`docs/`, AGENTS.md);
- CI, Bazel rules, test infrastructure, `tests/agents`, scripts.

Adjust the list when the code has moved (new packages, merged ones) and write the adjusted list back here.

Which areas were reviewed when is kept outside the repo, in `~/.local/state/dashql/kiss-review.md`, one line per
area and run: `<date> <START short hash> <area>`. Without an argument, take about 6 areas: first the ones the file
never lists (or all, if the file is missing), then those reviewed longest ago. Bring one forward if a lot changed in
it since its last review (`git diff --shortstat <its commit> START -- <paths>`). At the end of the run, append a line
per reviewed area (create the file if needed).

### Reviewers

1. Spawn one `general-purpose` reviewer per area, all in one message, in the background. They only read, so 6 at
   once is fine. Each prompt holds:
   - the paths of the area and the docs to read first (from `AGENTS.md`), and that the whole area is in scope, read
     module by module, not only recent diffs (with a "since" scope: the files those commits touched, read whole);
   - what changed in the area recently (`git log --oneline -20 -- <paths>`), as a hint where complexity grows;
   - the rule: no edits, no Bazel, no git stash/reset/checkout; git, grep and cat are fine;
   - the principles above, plus the decisions that affect the area (see the memory index);
   - what to hunt for:
     - one-caller helpers, forwarding layers, traits with one impl, options nobody sets;
     - duplication across statement kinds, packages or Rust and TS;
     - special cases a general rule covers;
     - two sources of truth for one fact;
     - dead code (grep callers, including the TS side of wasm exports);
     - modules much longer than their job, and state machines, flags or tokens that a simpler flow would remove;
     - test-only code in `src`;
     - test band-aids (retries, waits, ignored errors) that hide real bugs;
     - stale docs;
     - real bugs found in passing;
   - the output format: up to 15 findings ranked by value, each with file:line at HEAD, what's wrong, the simpler
     alternative, lines saved and confidence. Every claim must be verified against the code, and anything that couldn't
     be verified is dropped. The findings end with a 2–3 sentence verdict.
2. When the reports come in, spot-check one or two claims of each yourself (grep the callers). Write each area's
   findings to a file in the scratchpad (`findings_<area>.md`): the fix agents read them there.

## Phase 2: fix (waves of 2, each in its own worktree)

At most 2 fix agents at a time: each builds in a fresh worktree, which costs a Bazel output base (~3 GB disk, ~10 min
the first time) and memory. Pair areas with disjoint files. Order the waves so code fixes land before the docs that
describe them; CI and docs go last. The order that worked:
1. the Rust runtime with the TS runtime and agent;
2. the core analyzer with the app UI;
3. the formatter with CI and docs.

Start the next agent as soon as one finishes, if its files don't overlap with the one still running.

Write a common brief to the scratchpad and give each fix agent the brief, its findings file and the docs of its area.
Spawn it with `isolation: "worktree"`, `subagent_type: "general-purpose"`, in the background. The brief says:
- Put the worktree on a detached HEAD of current main (`git checkout --detach refs/heads/main`). Line numbers in
  the findings are at the review commit, so re-locate code by name.
- Verify each finding first. Skip it, and say why, if it's wrong, not simpler, or breaks behavior that tests or docs
  intend. Don't add a new abstraction while removing another.
- Fix the bugs first.
- **Unattended rule:** fix what keeps behavior or clearly fixes a bug. Don't do a finding that changes user-visible
  behavior, a public API, a file or buffer format, or that rewrites hundreds of lines of tests. List it as a decision
  for the owner with a sketch of the change.
- Snapshots must not move unless the finding intends it. Regenerate with the `:update` targets and review every
  changed case.
- Tests before every landing, all through `bazel-gov.sh`:
  - the touched packages' tests;
  - ESLint, Clippy and rustfmt;
  - for the app, the typecheck `build --config=fastbuild --output_groups=typecheck //packages/dashql-app:tsc` (a plain
    build skips it) and `//packages/dashql-app:test_chromium`.

  A timeout under load is not a failure: rerun. Report Bazel's real exit code. No dev servers, no own Chrome, never
  the agent tests in `tests/agents` (they download real harnesses).
- Commit one commit per concern. The message has a subject in the repo's style (an imperative sentence saying what
  the code now does), a blank line, then a body of the why, wrapped at 120 columns. No attribution lines.
- Land each commit on `main` oldest first, and only after its tests passed. Land only that commit's own diff, never a
  whole worktree tree, which would revert what others landed meanwhile. Move `main` with a compare-and-swap
  (`git update-ref refs/heads/main <new> <old>`), and bring the main checkout and its index along for those files
  only. If main moved and the diff doesn't apply: `git rebase refs/heads/main` in the worktree, re-test, land again.
  If the main checkout has staged or conflicting edits of another session in a file, stop and report; never force.
- End with a short report: each finding fixed, partly fixed, skipped or deferred (with the reason), the commits
  landed, the tests run with their results, and what's still open.

Bugs found during fixing that sit in another area go into that area's findings file if its wave hasn't started yet.

## Cleanup after each fix agent

- Remove its worktree and branch (`git worktree remove <path>`, `git branch -D <branch>`).
- Remove its Bazel output base, `~/.cache/bazel/_bazel_$USER/$(echo -n <absolute worktree path> | md5sum | cut -d' ' -f1)`
  (`chmod -R u+w` first). These filled the disk once.
- Remove empty folders that moves left in the main checkout.
- At the end, check that the main checkout is on `main` (`git symbolic-ref HEAD`), and `git status` is clean apart
  from other sessions' own edits.

## Morning report

Write it to the scratchpad as `kiss-review-<date>.md`, and say the same in the final message:
- a table per area: findings fixed, partly fixed, skipped and deferred, and commits;
- the areas reviewed, the commits landed and the net line count (`git diff --shortstat START main`);
- bugs fixed;
- behavior changes the owner will notice;
- decisions for the owner (the deferred findings with their sketches);
- skipped findings and why;
- what to watch after the push (CI lanes that didn't run locally, Renovate steps, browsers).

Nothing is pushed: the owner reviews `git log origin/main..main` and pushes.
