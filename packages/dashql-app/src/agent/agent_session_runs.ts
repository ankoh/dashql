import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { stringifyError, type Logger } from '@akohn/dashql/platform/logger/logger';
import type * as arrow from 'apache-arrow';

import type { AgentSessionChartSize, AgentSessionRunMessage } from '@akohn/dashql/platform/session/agent_session_client';
import type { WorkbookResultFiles } from '@akohn/dashql/platform/workbook/workbook_result_files';
import { encodeRunEvent, type RunEvent } from '@akohn/dashql/platform/workbook/run_events';
import { describeRunError, runScriptsOf, runWorkbookReported } from '@akohn/dashql/runtime/workbook_run_report';
import type { Runtime } from '@akohn/dashql/runtime/runtime';

import { renderVegaLitePng } from '@akohn/dashql-react/vegalite/vegalite_image';
import { arrowTableToRows } from '@akohn/dashql-react/vegalite/vegalite_rows';

const LOG_CTX = 'agent_session';

/// Send the file of the stored result of a script, kept while it is read. Resolves with what `write` resolves, null
/// without a file.
export async function sendStoredResult(runtime: Runtime, results: WorkbookResultFiles | null, workbookId: string, script: string, write: (name: string, data: Blob) => Promise<string>): Promise<string | null> {
    if (results == null) return null;
    const retained = await runtime.module.retainStoredResult(workbookId, script);
    if (retained == null) return null;
    try {
        return await write(retained.name, await results.readFile(workbookId, retained.name));
    } finally {
        await runtime.module.releaseStoredResult(retained.id);
    }
}

/// Render the chart of a script for `dashql vis`: the `@vis vegalite` tag of its last query with a result, as the image
/// download of the feed renders it
export async function renderScriptChart(runtime: Runtime, workbookId: string, script: string, table: arrow.Table | null, size: AgentSessionChartSize) {
    const ref = runtime.store.get('workbook', workbookId)?.scriptRefs[script];
    const vis = ref == null ? null : runtime.store.get('script', ref.scriptId)?.annotations.visualizeQuery;
    if (vis?.renderer !== 'vegalite') throw new Error(`the tab of DashQL finds no @vis vegalite tag in ${script}`);
    if (table == null) throw new Error(`${script} has no result`);
    return await renderVegaLitePng(vis.vegaLiteSpec, arrowTableToRows(table), size);
}

/// Why the tab runs nothing for the agent while the user has the workbooks
export const AGENT_PAUSED_ERROR = 'the user took the workbook back in DashQL (the prompt is in SQL), the tab runs nothing for you and takes no edits until the user switches the prompt back to AI: tell the user and stop';

/// What the runs of the agent need of the tab, the tests pass their own
export interface AgentSessionRunHost {
    runtime: Runtime;
    /// Resolves once the changes of the agent in the copies are in the workbooks of the tab
    settled: () => Promise<void>;
    /// May the agent use a connection?
    isConnectionAllowed: (connectionId: string) => boolean;
    /// Does the user have the workbooks, the prompt in SQL? The tab then runs nothing for the agent.
    paused: () => boolean;
    /// Send an event of a run to `dashql run`, resolves false once the run is gone there
    send: (runId: string, event: unknown) => Promise<boolean>;
    /// Write the stored result of a script of a workbook into the session, resolves with its path there, null if the tab
    /// has no file
    writeResult: (workbookId: string, script: string) => Promise<string | null>;
    /// Render the Vega-Lite chart of a script of a workbook with a result as PNG, rejects with why it can't
    renderChart: (workbookId: string, script: string, table: arrow.Table | null, size: AgentSessionChartSize) => Promise<{ png: Uint8Array; width: number; height: number }>;
}

/// The runs that `dashql run` asks the tab for (docs/design/agent_integration.md, "Runs in the tab"): the tab runs the
/// scripts of its workbook with its runtime, the feed shows the run and its progress as any other, and the events go
/// back to `dashql run`. A run takes only the connections that the agent may use and that are set up in the tab, the tab reaches what the
/// browser reaches.
export class AgentSessionRuns {
    private readonly running = new Map<string, AbortController>();
    private disposed = false;

    constructor(private readonly host: AgentSessionRunHost, private readonly logger: Logger) { }

    /// Take a message of the stream of the session
    handle(message: AgentSessionRunMessage): void {
        if (message.type === 'stop') {
            this.running.get(message.runId)?.abort();
            return;
        }
        if (!this.disposed) void this.run(message);
    }

    /// Stop every run, e.g. when the tab follows another session
    dispose(): void {
        this.disposed = true;
        for (const controller of this.running.values()) controller.abort();
    }

    private async run(message: Extract<AgentSessionRunMessage, { type: 'run' }>): Promise<void> {
        const { runId } = message;
        const controller = new AbortController();
        this.running.set(runId, controller);
        // The events go out one after the other, a run that `dashql run` gave up on stops
        let sending = Promise.resolve();
        const post = (event: RunEvent) => {
            const encoded = encodeRunEvent(event, message.rows);
            sending = sending.then(async () => {
                if (!(await this.host.send(runId, encoded))) controller.abort();
            }).catch(error => {
                this.logger.warn('Cannot send an event of the run of the agent', { run: runId, error: stringifyError(error) }, LOG_CTX);
            });
        };
        // A run of `dashql vis` gets the charts of its results before it finishes, the tab renders them like the feed
        const results: { script: string; table: arrow.Table | null }[] = [];
        const emit = (event: RunEvent) => {
            const size = message.chart ?? null;
            if (size != null && event.type === 'script_done') results.push({ script: event.script, table: event.table });
            if (size == null || event.type !== 'run_finished') return post(event);
            sending = sending.then(async () => {
                const charts: RunEvent[] = [];
                for (const { script, table } of results) charts.push(await this.chart(message.workbookId, script, table, size));
                for (const chart of charts) post(chart);
                post(event);
            });
        };
        const fail = (error: string) => {
            emit({ type: 'run_failed', error });
            emit({ type: 'run_finished', ms: 0, ok: 0, failed: 0, cancelled: 0, notRun: 0, interrupted: false });
        };
        try {
            if (this.host.paused()) return fail(AGENT_PAUSED_ERROR);
            this.logger.info('Running the workbook for the agent', { run: runId, workbook: message.workbookId, scripts: message.scripts.join(', ') }, LOG_CTX);
            // The agent changed the scripts before it ran them
            await this.host.settled();
            const { runtime } = this.host;
            const workbook = runtime.store.get('workbook', message.workbookId);
            if (workbook == null) return fail('the tab of DashQL has no such workbook');
            const { unknown } = runScriptsOf(runtime.core, workbook, message.scripts);
            if (unknown.length > 0) return fail(`the workbook has no script ${unknown.join(', ')}, its scripts are ${workbook.scriptOrder.join(', ') || 'none'}`);
            await runWorkbookReported(runtime, workbook, {
                label: message.label,
                scripts: message.scripts,
                refresh: message.refresh,
                signal: controller.signal,
                progressIntervalMs: null,
                // The feed shows the results of the run as those of its own runs
                analyze: true,
                prepareConnection: async conn => {
                    if (!this.host.isConnectionAllowed(conn.connectionId)) return 'the tab of DashQL does not let the agent use this connection, the user can allow it in the prompt';
                    if (conn.connectionHealth !== ConnectionHealth.ONLINE) return 'the connection is not set up in the tab of DashQL, set it up there';
                    return null;
                },
                // The agent reads the whole result from its file in the session, a result without one still goes back
                resultFile: async script => {
                    if (controller.signal.aborted) return null;
                    try {
                        return await this.host.writeResult(message.workbookId, script);
                    } catch (error) {
                        this.logger.warn('Cannot write the result of the agent into the session', { run: runId, error: stringifyError(error) }, LOG_CTX);
                        return null;
                    }
                },
                onReportError: error => this.logger.warn('Cannot report a script of the run of the agent', { run: runId, error: stringifyError(error) }, LOG_CTX),
            }, emit);
        } catch (error) {
            fail(describeRunError(error));
        } finally {
            // The charts post their events after them
            let last: Promise<void>;
            do {
                last = sending;
                await last;
            } while (last !== sending);
            this.running.delete(runId);
        }
    }

    /// The event of the chart of a script, with the error when it has none
    private async chart(workbookId: string, script: string, table: arrow.Table | null, size: AgentSessionChartSize): Promise<RunEvent> {
        try {
            const image = await this.host.renderChart(workbookId, script, table, size);
            return { type: 'script_chart', script, png: image.png, width: image.width, height: image.height, error: null };
        } catch (error) {
            return { type: 'script_chart', script, png: null, width: null, height: null, error: error instanceof Error ? error.message : stringifyError(error) };
        }
    }
}
