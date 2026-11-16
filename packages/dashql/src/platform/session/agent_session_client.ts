import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '../storage/storage_backend.js';
import type { AgentSessionState } from './agent_session_state.js';

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
/// ends the stream, rejects when it cannot be reached or the signal aborts.
export async function followAgentSession(
    target: AgentSessionTarget,
    onState: (state: AgentSessionState) => void,
    signal: AbortSignal,
): Promise<void> {
    const response = await fetch(agentSessionStreamUrl(target), { signal, headers: { Accept: 'text/event-stream' } });
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
    await expectOk(await fetch(workbookUrl(target, workbookId), { method: 'DELETE', signal }), 'the removal of the copy');
    const ordered = [...files.filter(file => file.path !== STORAGE_WORKBOOK_FILE), ...files.filter(file => file.path === STORAGE_WORKBOOK_FILE)];
    for (const file of ordered) await writeAgentSessionWorkbookFile(target, workbookId, file, signal);
}

/// Write a file of the copy of a workbook in the session, e.g. a script that the page changed
export async function writeAgentSessionWorkbookFile(target: AgentSessionTarget, workbookId: string, file: AgentSessionWorkbookFile, signal?: AbortSignal): Promise<void> {
    await expectOk(await fetch(workbookUrl(target, workbookId, file.path), { method: 'PUT', body: file.content, signal }), `the write of ${file.path}`);
}

/// Remove a file of the copy of a workbook in the session, e.g. a script that the page deleted
export async function deleteAgentSessionWorkbookFile(target: AgentSessionTarget, workbookId: string, path: string, signal?: AbortSignal): Promise<void> {
    await expectOk(await fetch(workbookUrl(target, workbookId, path), { method: 'DELETE', signal }), `the removal of ${path}`);
}

/// Read a file of the copy of a workbook in the session as text
export async function readAgentSessionWorkbookText(target: AgentSessionTarget, workbookId: string, path: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch(workbookUrl(target, workbookId, path), { signal });
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
