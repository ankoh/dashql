// The events of a run of a workbook that reports what happens: `dashql run` prints them, a tab that runs the workbook
// for the agent of a session sends them to `dashql run` (docs/design/agent_integration.md, "Runs in the tab")
import * as arrow from 'apache-arrow';

/// What happens in a run
export type RunEvent =
    /// The run starts, with the scripts that it reports results of: the named ones, every one by default
    | { type: 'run_started'; workbook: string; scripts: string[] }
    /// A connection that statements run on is set up, by its label, e.g. `trino http://localhost:8080`
    | { type: 'connection_setup'; connection: string }
    | { type: 'connection_ready'; connection: string; ms: number }
    | { type: 'connection_failed'; connection: string; error: string }
    /// A script runs once the scripts that it follows are done
    | { type: 'script_planned'; script: string; follows: string[] }
    | { type: 'script_started'; script: string }
    /// The latest progress of a query of a running script
    | { type: 'script_progress'; script: string; phase: string | null; percent: number | null; rows: number | null }
    /// A script ran or the cache served its result: the rows of the result, the table with its first rows or all of
    /// them, its key and its file in the query result cache
    | { type: 'script_done'; script: string; ms: number; rows: number | null; table: arrow.Table | null; cached: boolean; key: string | null; file: string | null }
    /// A statement of a script failed: the error and the statement that was sent
    | { type: 'script_failed'; script: string; ms: number; error: string; statement: string | null }
    /// The run stopped a running script, e.g. after another script failed
    | { type: 'script_cancelled'; script: string; ms: number }
    /// A script that the run reports did not run, and why
    | { type: 'script_not_run'; script: string; reason: string }
    /// The run itself failed, e.g. a script can't be planned. A failed script is reported as such.
    | { type: 'run_failed'; error: string }
    /// The chart of a script as PNG, rendered by the tab after the result of the script for a run that asked for charts
    /// (`chart` of a run request): null with the error when the script has no Vega-Lite chart or no result
    | { type: 'script_chart'; script: string; png: Uint8Array | null; width: number | null; height: number | null; error: string | null }
    /// The run is over: what happened to the scripts that it reports
    | { type: 'run_finished'; ms: number; ok: number; failed: number; cancelled: number; notRun: number; interrupted: boolean };

/// The bytes of a text of base64
function fromBase64(text: string): Uint8Array {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/// The base64 of bytes
function toBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
}

/// An event as JSON: the table of a result with its first rows as an Arrow IPC stream in base64, a chart as PNG in base64
export function encodeRunEvent(event: RunEvent, rows: number): unknown {
    if (event.type === 'script_chart') return { ...event, png: event.png == null ? null : toBase64(event.png) };
    if (event.type !== 'script_done') return event;
    const table = event.table == null ? null : toBase64(arrow.tableToIPC(event.table.slice(0, rows), 'stream'));
    return { ...event, table };
}

/// An event of its JSON, null for anything else
export function decodeRunEvent(value: unknown): RunEvent | null {
    if (value == null || typeof value !== 'object' || typeof (value as { type?: unknown }).type !== 'string') return null;
    const event = value as RunEvent & { table?: unknown; png?: unknown };
    if (event.type === 'script_chart') {
        let png: Uint8Array | null;
        try {
            png = typeof event.png === 'string' ? fromBase64(event.png) : null;
        } catch {
            png = null;
        }
        return { ...event, png };
    }
    if (event.type !== 'script_done') return event;
    let table: arrow.Table | null = null;
    if (typeof event.table === 'string') {
        try {
            table = arrow.tableFromIPC(fromBase64(event.table));
        } catch {
            table = null;
        }
    }
    return { ...event, table };
}
