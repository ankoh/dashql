# Runs that the tab drives

Status: built. `dashql run` in a session of `dashql connect` asks the tab of DashQL to run a workbook that the tab
copied into the session; the tab runs it with its own runtime, its feed shows the run, and the events go back to
`dashql run`.

A tab that follows a session (`docs/wip/agent_session.md`) shows what the agent does: its questions, the steps of its
tools, the scripts it edits. The runs of the agent are runs of the tab, so the live preview of a query is the feed of
the tab as it is, with the running query, its progress, the profile of Trino and the result. Nothing of the feed is
specific to the session.

## Why the tab runs

The other ways were to show the state of the runtime of `dashql run` in the tab: mirror its queries into the runtime of
the tab, or send the views of its store to the page.

- **Mirroring** needs a query that runs elsewhere in the core runtime, a second kind of query that every part that
  handles queries knows, and a marker, a field of the protocol and a call of the runtime for every new thing to show.
- **Views over the wire** make every view kind a contract between the version of the tab and the version of
  `dashql-cli` that npx runs.

When the tab runs the scripts, it shows its own state. Between the command line tool and the tab there are the files of
the copy, the run request, the `RunEvent`s and the first rows of the results.

## No proxy

The tab reaches what the browser reaches: an endpoint that doesn't allow the origin of DashQL (CORS) can't be reached
from the web app, by the user as by the agent. The desktop app reaches every endpoint through its native proxy. A proxy
of `dashql connect` for the tab was considered and left out: it would make the process an exit to the network for the
agent and the intranet reachable for a script injected into the page, and the hosts of a Salesforce login are known
only from its tokens. With the proxy, the allowed hosts would go on the command line (`--allow`), which the user
decides on.

## The flow

1. **Files come in.** The agent writes the copy of the workbook (`.dashql/workbooks/<workbook id>/`), the tab takes the
   changed scripts with their text (`agent/agent_session_copy.ts`), without a rewrite to accept or reject.
2. **The run request.** `dashql run .dashql/workbooks/<id>` in a session of `dashql connect` (`DASHQL_SESSION`) posts
   `{ workbookId, label, scripts, refresh, rows }` to `/v1/runs/<token>` (`run_tab.ts`). The server stamps the copies,
   sends the state, then the run as an event `run` on the stream of the tab (`event: run`), and answers with the
   events of the run as JSON lines, its header `X-DashQL-Run` names the run.
3. **The tab runs.** `AgentSessionRuns` (`agent/agent_session_runs.ts`) waits until the changes of the agent are in the
   workbook, then runs it with `runWorkbookReported` of the runtime (`runtime/workbook_run_report.ts`), the same code
   that `dashql run` runs without a tab. A connection that the agent may not use, or that is not online in the tab,
   fails before the first statement and its scripts don't run.
4. **The results go into the session.** The cached result of a script with a key goes as its Parquet file to
   `PUT /v1/results/<token>/<key>` before the script is reported: the server writes it into the query result cache of
   the session, `.dashql/cache/<key>.<uuid>.parquet`, and answers with the path, where the agent reads the whole
   result. A result without a key has no file, as in a run of the process.
5. **The events go back.** The tab posts every event to `/v1/runs/<token>/<run id>` (`encodeRunEvent`: the table of a
   result with its first `rows` rows as an Arrow IPC stream in base64, the file in the session), the server writes it
   to the answer, which ends with `run_finished`. `dashql run` prints them with its reporters.

- **Stop.** Ctrl-C posts `DELETE /v1/runs/<token>/<run id>`, the server tells the tab (`{ type: 'stop' }`), the tab stops
  the run and its events end with `run_finished` as interrupted. A `dashql run` that goes away stops the run as well, an
  event of a run that is gone answers 404 and the tab stops.
- **Charts.** A run request of `dashql vis` carries `chart`, the size of the images. After the results the tab renders
  the `@vis vegalite` chart of every script that the run reports with its result (`renderScriptChart`, the renderer of
  the image download of the feed) and sends each as `script_chart` with the PNG in base64, or with the error when the
  script has no chart or no result, then `run_finished`. A tab of protocol 1 ignores `chart` and sends none.
- **The user has the workbook.** While the prompt of the tab is in SQL, the tab runs nothing for the agent: the run ends
  at once with `run_failed` (`AGENT_PAUSED_ERROR`) and `run_finished`, see "Who has the workbook" in `agent_session.md`.
- **No tab.** Without a tab on the stream the run request answers 409. A run that no tab takes within 30 s ends with
  `run_failed`, so does a run whose tab goes away.
- **Other folders.** A workbook folder that no tab copied, and every run outside a session of `dashql connect`, runs in
  the process of `dashql run` with Trino with basic auth and the embedded Hyper.

## What went

- The login relay of `dashql connect`: the logins through the tab, `/v1/auth`, `/v1/login`, `/v1/relay`, the stand-in
  tokens of the core and `connectionAuthorization` of the module. The tab logs in as it does for its own runs.
- The markers of runs in the journal (`Script started`, `Script progress`, `Script result`) and the import of the
  results of the agent into the cache of the tab.
- The accept and reject of the edits of the agent.

## Open

- The way back from an edit of the agent: the editor may not undo a text that was set from outside.
- Scripts that the agent creates take the name that the page gives them, a run of the agent names its file.
