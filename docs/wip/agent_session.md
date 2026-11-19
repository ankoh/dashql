# Agent Sessions: plan

What is built of agent sessions is in [docs/design/agent_session.md](../design/agent_session.md) and
[docs/design/agent_integration.md](../design/agent_integration.md). This document keeps what is planned.

## Two cases

- **A, the conversation starts in the page.** The user has a workbook with working connections in the tab, switches
  to AI and runs the line of `dashql connect` in the folder of a project. The site is the truth, the disk holds a copy
  for the agent. Built, see "The copies of the workbooks" of the design.
- **B, the user stays in the shell.** The agent creates a workbook folder in the project and the page only shows it.
  The folder is the truth, the page holds a copy.

In both cases the agent works on files on disk and the page follows them, the direction of the files is what differs.

## The rest of the copy

- Scripts that the agent deletes or renames, the order of the workbook file of the copy, the attachments, the
  functions of a connection in its catalog file.
- A native workbook has its folder on disk already, the agent could work in that folder.
- When the session ends, the tab has everything, the copy is a cache: removed with the journal, or kept to start the
  next session faster.
- **Keep in project** moves the copy to a visible folder of the project and registers it as a native workbook (the
  desktop app). From then on the folder is the truth, as in case B.
- The journal can replace `PostToolUse` for the edits of the agent.

## Connections travel with the workbook

The parameters of a connection (host, catalog, user name, no secrets) are in the workbook file, `connections[].params`
matched by `connectionId`. They travel both ways with the workbook: `dashql run` uses the parameters of the folder, the
app takes them when it opens a folder. A connection that works in the tab has the same address on disk, and one that
the agent set up appears in the tab.

## How the agent learns DashQL

- **A skill** only for the installed path without `dashql connect` (case B with hooks in the settings): a short
  `SKILL.md` in the package that says when to use DashQL and to run `dashql describe`, as the one of hyperdb-edge.
- **MCP as a fallback.** An MCP server is the fallback for the runs in the process of `dashql connect` if a sandbox
  stands in the way: a tool of an MCP server runs in that process, outside the sandbox, and needs no token of the
  session in the environment of the agent.

To check:

- Whether the default `shell_environment_policy` of Codex drops variables with `TOKEN` in their name from the commands
  of the agent, then `dashql run` lacks `DASHQL_SESSION_TOKEN`.
- Whether the sandbox of Codex (`workspace-write` without network) and the one of Claude Code let a command reach
  `127.0.0.1`. `dashql connect` can allow it for Codex with `-c`.
- Whether the managed settings of a company allow an MCP server that a session adds, should the fallback be needed.

## Order

1. The rest of the copy (see above).
2. The parameters of connections from the folder in `dashql run` and in the app.

## Next

- `@akohn/dashql` and `@akohn/dashql-cli` are not on npm yet, the line of the prompt needs both published.
- `dashql connect` without `--launch`: the server alone, for a harness that runs already or in an IDE, with hooks
  installed once in its settings.
