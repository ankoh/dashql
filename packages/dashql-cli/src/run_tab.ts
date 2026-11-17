// dashql run in a session of dashql connect: the tab of DashQL runs a workbook that it copied into the session and
// sends the events of the run back (docs/wip/tab_driven_runs.md)
import {
    startAgentSessionRun,
    stopAgentSessionRun,
    type AgentSessionRunRequest,
    type AgentSessionTarget,
} from '@akohn/dashql/platform/session/agent_session_client';
import { decodeRunEvent, type RunEvent } from '@akohn/dashql/platform/workbook/run_events';
import type { ReportedRunEnd } from '@akohn/dashql/runtime/workbook_run_report';

/// Ask the tab for a run and report its events until run_finished. An interrupt asks the tab to stop the run, a second
/// one ends the process. Throws when the tab can't take the run, e.g. when no tab follows the session.
export async function runInTab(server: AgentSessionTarget, request: AgentSessionRunRequest, signal: AbortSignal, emit: (event: RunEvent) => void): Promise<ReportedRunEnd> {
    const { runId, events } = await startAgentSessionRun(server, request);
    const stop = () => void stopAgentSessionRun(server, runId).catch(() => { });
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
    let failed = false;
    try {
        const reader = events.getReader();
        const decoder = new TextDecoder();
        let buffered = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffered += decoder.decode(value, { stream: true });
            let end: number;
            while ((end = buffered.indexOf('\n')) >= 0) {
                const event = decodeRunEvent(JSON.parse(buffered.slice(0, end)));
                buffered = buffered.slice(end + 1);
                if (event == null) continue;
                emit(event);
                if (event.type === 'run_failed') failed = true;
                if (event.type === 'run_finished') {
                    if (event.interrupted) return 'interrupted';
                    return failed || event.failed + event.cancelled + event.notRun > 0 ? 'failed' : 'ok';
                }
            }
        }
    } finally {
        signal.removeEventListener('abort', stop);
    }
    // The server ends a run that no tab took or whose tab went away with run_failed
    if (!failed) emit({ type: 'run_failed', error: 'the tab of DashQL stopped answering' });
    return signal.aborted ? 'interrupted' : 'failed';
}
