import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '../storage/storage_backend.js';
import { fetchAgentSession } from './agent_session_protocol.js';
import type { AgentSessionState } from './agent_session_state.js';
import type { SessionConnections } from './workbook_journal.js';

/// Where a page finds the server of a session: the one of `dashql connect` on this machine
export interface AgentSessionTarget {
    /// The base URL of the server, http on a loopback address
    endpoint: string;
    /// The token of the server
    token: string;
}

/// Hosts of this machine
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/// The target of a link to a session, null unless it names a server on this machine and a token
export function parseAgentSessionTarget(endpoint: unknown, token: unknown): AgentSessionTarget | null {
    if (typeof endpoint !== 'string' || typeof token !== 'string' || token.length === 0) return null;
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    return { endpoint: url.origin, token };
}

/// The URL of the stream of the states of a session
export function agentSessionStreamUrl(target: AgentSessionTarget): string {
    const url = new URL('/v1/stream', target.endpoint);
    url.searchParams.set('token', target.token);
    return url.toString();
}

/// Follow a session: the server sends its state with every event as server-sent events. Resolves when the server
/// ends the stream, rejects when it cannot be reached or the signal aborts, with an AgentSessionProtocolError when
/// the page and the server don't speak with each other.
/// A run that `dashql run` asks the tab for: the scripts of the copy of a workbook of the tab, all of them without names
export interface AgentSessionRunRequest {
    workbookId: string;
    /// What the events name the workbook, the folder that the agent named
    label: string;
    scripts: string[];
    refresh: boolean;
    /// The rows of a result that go back with its event
    rows: number;
    /// Render the charts of the scripts that the run reports as PNG in this size, after their results (`dashql vis`).
    /// Absent for a run without charts; a tab of protocol 1 ignores it.
    chart?: AgentSessionChartSize | null;
}

/// The size of the chart images of a run: CSS pixels, the images have `scale` times as many pixels
export interface AgentSessionChartSize {
    width: number;
    height: number;
    scale: number;
}

/// What the stream of a session tells the tab about runs: start a run, stop it
export type AgentSessionRunMessage =
    | ({ type: 'run'; runId: string } & AgentSessionRunRequest)
    | { type: 'stop'; runId: string };

/// The header of the answer to a run request that names the run
export const AGENT_SESSION_RUN_HEADER = 'X-DashQL-Run';

/// Follow the state of a session: the state after every change, and the runs that `dashql run` asks the tab for
export async function followAgentSession(
    target: AgentSessionTarget,
    onState: (state: AgentSessionState) => void,
    signal: AbortSignal,
    onRun?: (message: AgentSessionRunMessage) => void,
): Promise<void> {
    const response = await fetchAgentSession(agentSessionStreamUrl(target), { signal, headers: { Accept: 'text/event-stream' } });
    if (!response.ok || response.body == null) throw new Error(`the session answered with ${response.status}`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buffered += value;
        // An event ends with an empty line, its data lines carry the state, or a run with the event `run`
        let end: number;
        while ((end = buffered.indexOf('\n\n')) >= 0) {
            const block = buffered.slice(0, end);
            buffered = buffered.slice(end + 2);
            const lines = block.split('\n');
            const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (data.length === 0) continue;
            if (lines.some(line => line === 'event: run')) onRun?.(JSON.parse(data) as AgentSessionRunMessage);
            else onState(JSON.parse(data) as AgentSessionState);
        }
    }
}

/// A file of a workbook folder, its path in the folder with forward slashes
export interface AgentSessionWorkbookFile {
    path: string;
    content: string | Uint8Array<ArrayBuffer> | Blob;
}

/// The URL of a file of a workbook of a session, or of the whole copy of a workbook without a path
function workbookUrl(target: AgentSessionTarget, workbookId: string, file?: string): string {
    const parts = ['v1', 'workbooks', target.token, workbookId, ...(file?.split('/') ?? [])];
    return new URL(`/${parts.map(encodeURIComponent).join('/')}`, target.endpoint).toString();
}

async function expectOk(response: Response, what: string): Promise<void> {
    if (!response.ok) throw new Error(`the session answered ${what} with ${response.status}`);
}

/// Write the workbook of the page into the folder of the session, `.dashql/workbooks/<workbook id>/`, where the agent
/// works on it. An older copy goes first. The workbook file comes last: with it, the server announces the copy in the
/// state of the session.
export async function writeAgentSessionWorkbook(
    target: AgentSessionTarget,
    workbookId: string,
    files: readonly AgentSessionWorkbookFile[],
    signal?: AbortSignal,
): Promise<void> {
    await expectOk(await fetchAgentSession(workbookUrl(target, workbookId), { method: 'DELETE', signal }), 'the removal of the copy');
    const ordered = [...files.filter(file => file.path !== STORAGE_WORKBOOK_FILE), ...files.filter(file => file.path === STORAGE_WORKBOOK_FILE)];
    for (const file of ordered) await writeAgentSessionWorkbookFile(target, workbookId, file, signal);
}

/// Write a file of the copy of a workbook in the session, e.g. a script that the page changed
export async function writeAgentSessionWorkbookFile(target: AgentSessionTarget, workbookId: string, file: AgentSessionWorkbookFile, signal?: AbortSignal): Promise<void> {
    await expectOk(await fetchAgentSession(workbookUrl(target, workbookId, file.path), { method: 'PUT', body: file.content, signal }), `the write of ${file.path}`);
}

/// Remove a file of the copy of a workbook in the session, e.g. a script that the page deleted
export async function deleteAgentSessionWorkbookFile(target: AgentSessionTarget, workbookId: string, path: string, signal?: AbortSignal): Promise<void> {
    await expectOk(await fetchAgentSession(workbookUrl(target, workbookId, path), { method: 'DELETE', signal }), `the removal of ${path}`);
}

/// Read a file of the copy of a workbook in the session as text
export async function readAgentSessionWorkbookText(target: AgentSessionTarget, workbookId: string, path: string, signal?: AbortSignal): Promise<string> {
    const response = await fetchAgentSession(workbookUrl(target, workbookId, path), { signal });
    await expectOk(response, `the read of ${path}`);
    return await response.text();
}

/// The files of a workbook folder in the layout of OPFS (`workbooks/<id>/` of the root of the app) as a page copies
/// them into a session: the workbook file, the scripts and the attachments. Null for a folder without a workbook file,
/// e.g. the mirror of the attachments of a native workbook.
export async function readWorkbookFolderFiles(folder: FileSystemDirectoryHandle): Promise<AgentSessionWorkbookFile[] | null> {
    let workbook: File;
    try {
        workbook = await (await folder.getFileHandle(STORAGE_WORKBOOK_FILE)).getFile();
    } catch {
        return null;
    }
    const files: AgentSessionWorkbookFile[] = [];
    for (const sub of [STORAGE_SCRIPTS_FOLDER, STORAGE_ATTACHMENTS_FOLDER]) {
        let dir: FileSystemDirectoryHandle;
        try {
            dir = await folder.getDirectoryHandle(sub);
        } catch {
            continue;
        }
        const entries: [string, FileSystemFileHandle][] = [];
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'file') entries.push([name, handle as FileSystemFileHandle]);
        }
        entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        for (const [name, handle] of entries) files.push({ path: `${sub}/${name}`, content: await handle.getFile() });
    }
    return [{ path: STORAGE_WORKBOOK_FILE, content: workbook }, ...files];
}

/// Tell the session which connections the agent may use: `dashql run` on a folder of its own refuses the others, the
/// tab runs only them
export async function writeAgentSessionConnections(target: AgentSessionTarget, connections: SessionConnections, signal?: AbortSignal): Promise<void> {
    const url = new URL(`/v1/connections/${encodeURIComponent(target.token)}`, target.endpoint);
    await expectOk(await fetchAgentSession(url, { method: 'PUT', body: JSON.stringify(connections), signal }), 'the connections of the agent');
}

/// The URL of the runs of a session, or of one run
function runUrl(target: AgentSessionTarget, runId?: string): URL {
    const parts = ['v1', 'runs', target.token, ...(runId == null ? [] : [runId])];
    return new URL(`/${parts.map(encodeURIComponent).join('/')}`, target.endpoint);
}

/// Ask the tab that follows a session for a run: the answer streams the events of the run as JSON lines
/// (`encodeRunEvent`) until run_finished, its header AGENT_SESSION_RUN_HEADER names the run. Throws with the error of
/// the server, e.g. when no tab follows the session.
export async function startAgentSessionRun(target: AgentSessionTarget, request: AgentSessionRunRequest): Promise<{ runId: string; events: ReadableStream<Uint8Array> }> {
    const response = await fetchAgentSession(runUrl(target), { method: 'POST', body: JSON.stringify(request) });
    const runId = response.headers.get(AGENT_SESSION_RUN_HEADER);
    if (!response.ok || runId == null || response.body == null) {
        let error = `the session answered the run with ${response.status}`;
        try {
            const answer = await response.json() as { error?: unknown };
            if (typeof answer?.error === 'string') error = answer.error;
        } catch {
            // The status says enough
        }
        throw new Error(error);
    }
    return { runId, events: response.body };
}

/// Ask the tab to stop a run
export async function stopAgentSessionRun(target: AgentSessionTarget, runId: string): Promise<void> {
    await expectOk(await fetchAgentSession(runUrl(target, runId), { method: 'DELETE' }), 'the stop of the run');
}

/// Send an event of a run that the tab runs, as encodeRunEvent made it. False once the run is gone, e.g. `dashql run`
/// ended: the tab stops it.
export async function postAgentSessionRunEvent(target: AgentSessionTarget, runId: string, event: unknown): Promise<boolean> {
    const response = await fetchAgentSession(runUrl(target, runId), { method: 'POST', body: JSON.stringify(event) });
    if (response.status === 404) return false;
    await expectOk(response, 'the event of the run');
    return true;
}

/// Write the cached result of a key of a run of the tab into the query result cache of the session,
/// `.dashql/cache/<key>.<uuid>.parquet`, where the agent reads it. Resolves with the path of the file.
export async function writeAgentSessionResult(target: AgentSessionTarget, key: string, data: Blob): Promise<string> {
    const url = new URL(`/v1/results/${encodeURIComponent(target.token)}/${encodeURIComponent(key)}`, target.endpoint);
    const response = await fetchAgentSession(url, { method: 'PUT', body: data });
    await expectOk(response, `the result ${key}`);
    return ((await response.json()) as { file: string }).file;
}
