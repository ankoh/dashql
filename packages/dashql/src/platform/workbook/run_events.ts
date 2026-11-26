// The events of a run of a workbook that reports what happens: the page prints them for the `dashql run` and `dashql vis`
// of an agent (docs/design/agent_integration.md)
import type * as arrow from 'apache-arrow';

/// What happens in a run
export type RunEvent =
    /// The run starts, with the scripts that it reports results of: the named ones, every one by default
    | { type: 'run_started'; scripts: string[] }
    /// A connection that statements run on can't be used, by its label, e.g. `trino http://localhost:8080`
    | { type: 'connection_failed'; connection: string; error: string }
    | { type: 'script_started'; script: string }
    /// A script ran or the cache served its result: the query of the result, its rows, a table with its schema and its
    /// first rows (`rows` of the options of the run) and the file of its stored result
    | { type: 'script_done'; script: string; ms: number; queryId: number | null; rows: number | null; table: arrow.Table | null; cached: boolean; file: string | null }
    /// A statement of a script failed: the error and the statement that was sent
    | { type: 'script_failed'; script: string; ms: number; error: string; statement: string | null }
    /// The run stopped a running script, e.g. after another script failed
    | { type: 'script_cancelled'; script: string; ms: number }
    /// A script that the run reports did not run, and why
    | { type: 'script_not_run'; script: string; reason: string }
    /// The run itself failed, e.g. a script can't be planned. A failed script is reported as such.
    | { type: 'run_failed'; error: string }
    /// The run is over: what happened to the scripts that it reports
    | { type: 'run_finished'; ms: number; ok: number; failed: number; cancelled: number; notRun: number; interrupted: boolean };
