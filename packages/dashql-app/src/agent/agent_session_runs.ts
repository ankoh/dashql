import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { stringifyError, type Logger } from '@akohn/dashql/platform/logger/logger';
import type { AgentSessionRunMessage } from '@akohn/dashql/platform/session/agent_session_client';
import type { QueryResultCache } from '@akohn/dashql/platform/query/query_result_cache';
import { encodeRunEvent, type RunEvent } from '@akohn/dashql/platform/workbook/run_events';
import { describeRunError, runScriptsOf, runWorkbookReported } from '@akohn/dashql/runtime/workbook_run_report';
import type { Runtime } from '@akohn/dashql/runtime/runtime';

const LOG_CTX = 'agent_session';

/// Send the cached file of a key, kept while it is read. Resolves with what `write` resolves, null without a file.
export async function sendCachedResult(cache: QueryResultCache | null, key: string, write: (data: Blob) => Promise<string>): Promise<string | null> {
    const retained = await cache?.retain(key);
    if (retained == null) return null;
    try {
        return await write(await cache!.readFile(retained.entry.name));
    } finally {
        await retained.release();
    }
}

/// What the runs of the agent need of the tab, the tests pass their own
export interface AgentSessionRunHost {
    runtime: Runtime;
    /// Resolves once the changes of the agent in the copies are in the workbooks of the tab
    settled: () => Promise<void>;
    /// May the agent use a connection?
    isConnectionAllowed: (connectionId: string) => boolean;
    /// Send an event of a run to `dashql run`, resolves false once the run is gone there
    send: (runId: string, event: unknown) => Promise<boolean>;
    /// Write the cached result of a key into the session, resolves with its path there, null if the tab has no file
    writeResult: (key: string) => Promise<string | null>;
}

/// The runs that `dashql run` asks the tab for (docs/wip/tab_driven_runs.md): the tab runs the scripts of its workbook
/// with its runtime, the feed shows the run and its progress as any other, and the events go back to `dashql run`. A
/// run takes only the connections that the agent may use and that are set up in the tab, the tab reaches what the
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
        const emit = (event: RunEvent) => {
            const encoded = encodeRunEvent(event, message.rows);
            sending = sending.then(async () => {
                if (!(await this.host.send(runId, encoded))) controller.abort();
            }).catch(error => {
                this.logger.warn('Cannot send an event of the run of the agent', { run: runId, error: stringifyError(error) }, LOG_CTX);
            });
        };
        const fail = (error: string) => {
            emit({ type: 'run_failed', error });
            emit({ type: 'run_finished', ms: 0, ok: 0, failed: 0, cancelled: 0, notRun: 0, interrupted: false });
        };
        try {
            this.logger.info('Running the workbook for the agent', { run: runId, workbook: message.workbookId, scripts: message.scripts.join(', ') }, LOG_CTX);
            // The agent changed the scripts before it ran them
            await this.host.settled();
            const { runtime } = this.host;
            const workbook = runtime.store.get('workbook', message.workbookId);
            if (workbook == null) return fail('the tab of DashQL has no such workbook');
            const { unknown } = runScriptsOf(workbook, message.scripts);
            if (unknown.length > 0) return fail(`the workbook has no script ${unknown.join(', ')}, its scripts are ${workbook.scriptOrder.join(', ') || 'none'}`);
            await runWorkbookReported(runtime, workbook, {
                label: message.label,
                scripts: message.scripts,
                refresh: message.refresh,
                signal: controller.signal,
                progressIntervalMs: null,
                prepareConnection: async conn => {
                    if (!this.host.isConnectionAllowed(conn.connectionId)) return 'the tab of DashQL does not let the agent use this connection, the user can allow it in the prompt';
                    if (conn.connectionHealth !== ConnectionHealth.ONLINE) return 'the connection is not set up in the tab of DashQL, set it up there';
                    return null;
                },
                // The agent reads the whole result from its file in the session, a result without one still goes back
                resultFile: async key => {
                    if (controller.signal.aborted) return null;
                    try {
                        return await this.host.writeResult(key);
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
            await sending;
            this.running.delete(runId);
        }
    }
}
