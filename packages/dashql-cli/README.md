# dashql

`dashql` is the command line tool of the agents of the DashQL desktop app. The app runs a harness of the machine
(Claude Code, Codex or opencode) for a question that the user asks in a workbook, and the agent works on that workbook
with these commands. They read and change the workbook that the window shows and run its scripts there, on the
connections of the user. The design is in [docs/design/agent_integration.md](../../docs/design/agent_integration.md).

The binary ships only inside DashQL.app, as `Contents/Resources/bin/dashql`. It is not published anywhere else.

## Calls

Every command but `guide` and `help` is a call of the page of the workbook. The app writes a session file into the
folder of the workbook (`session.json`: the address of its server on `127.0.0.1`, a token and the workbook id) and puts
a `bin/dashql` first on the `PATH` of the harness that passes it:

```sh
dashql --session <folder>/session.json scripts
```

`dashql` posts the command with its arguments to `/v1/call` of the server and prints the answer as it streams: text for
stdout and stderr, then the exit code. Exit codes: 0 when the command succeeded, 1 when it failed, 2 on usage errors and
when DashQL is not running or runs no question on the workbook.

## Commands

| Command | Does |
|---|---|
| `guide` | How to work on DashQL with these commands, read it first |
| `scripts` | The scripts in the order of the feed, the connections and the attachments |
| `read <script>` | The text of a script |
| `edit <script> [--file <file>] [--connection <id>]` | Replace or create a script with the text of the file or of stdin |
| `move <script> (--before <script> \| --after <script> \| --first \| --last)` | Move a script in the feed |
| `catalog [<connection>]` | The tables that you can query, as `CREATE TABLE` statements |
| `lint <script>` | Check a script without running it |
| `format <script>` | Pretty print a script in place |
| `run [<script>...] [--refresh] [--rows <n>]` | Run scripts in DashQL, print their first rows (10, up to 10000) and the files of their results |
| `vis <script> [--width <n>] [--height <n>] [--refresh]` | Check the chart of a script against its result and render it as PNG |
| `help` | The usage |

The command table in `src/commands.rs` makes the usage, the guide is `src/guide.rs`.

## Development

```sh
bazel run //packages/dashql-cli:dashql -- guide
bazel test //packages/dashql-cli:all
```

The tests run the commands against a fake server of the app on loopback.
