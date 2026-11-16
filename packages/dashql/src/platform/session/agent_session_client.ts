import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '../storage/storage_backend.js';
import { fetchAgentSession } from './agent_session_protocol.js';
import type { AgentSessionLoginAnswer, AgentSessionOAuth, AgentSessionState } from './agent_session_state.js';
import type { SessionConnections } from './workbook_journal.js';

/// Where a page finds the server of a session: `dashql session serve` on this machine
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
export async function followAgentSession(
    target: AgentSessionTarget,
    onState: (state: AgentSessionState) => void,
    signal: AbortSignal,
): Promise<void> {
    const response = await fetchAgentSession(agentSessionStreamUrl(target), { signal, headers: { Accept: 'text/event-stream' } });
    if (!response.ok || response.body == null) throw new Error(`the session answered with ${response.status}`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buffered += value;
        // An event ends with an empty line, its data lines carry the state
        let end: number;
        while ((end = buffered.indexOf('\n\n')) >= 0) {
            const block = buffered.slice(0, end);
            buffered = buffered.slice(end + 2);
            const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (data.length > 0) onState(JSON.parse(data) as AgentSessionState);
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

/// Read the newest file of a key of the query result cache of the session, the result of a run of the agent
export async function readAgentSessionResult(target: AgentSessionTarget, key: string, signal?: AbortSignal): Promise<Blob> {
    const url = new URL(`/v1/results/${encodeURIComponent(target.token)}/${encodeURIComponent(key)}`, target.endpoint);
    const response = await fetchAgentSession(url, { signal });
    if (!response.ok) throw new Error(`the session answered the result ${key} with ${response.status}`);
    return await response.blob();
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

/// Tell the session which connections the agent may use, `dashql run` refuses the others, and how the redirect page
/// of the app hands a Salesforce login back to the tab. The server keeps the OAuth settings in memory only.
export async function writeAgentSessionConnections(
    target: AgentSessionTarget,
    connections: SessionConnections,
    oauth: AgentSessionOAuth | null = null,
    signal?: AbortSignal,
): Promise<void> {
    const url = new URL(`/v1/connections/${encodeURIComponent(target.token)}`, target.endpoint);
    const body = oauth == null ? connections : { ...connections, oauth };
    await expectOk(await fetchAgentSession(url, { method: 'PUT', body: JSON.stringify(body), signal }), 'the connections of the agent');
}

/// Answer a login that a run of the agent waits for (`logins` of the state): the callback of the redirect page or the
/// credentials of the connection of the tab. They go to the process of `dashql connect`, never to the agent.
export async function answerAgentSessionLogin(target: AgentSessionTarget, connectionId: string, answer: AgentSessionLoginAnswer, signal?: AbortSignal): Promise<void> {
    const url = new URL(`/v1/login/${encodeURIComponent(target.token)}/${encodeURIComponent(connectionId)}`, target.endpoint);
    await expectOk(await fetchAgentSession(url, { method: 'POST', body: JSON.stringify(answer), signal }), 'the login of the agent');
}
