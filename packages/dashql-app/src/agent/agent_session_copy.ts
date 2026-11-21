import {
    deleteAgentSessionWorkbookFile,
    readAgentSessionWorkbookText,
    readWorkbookFolderFiles,
    writeAgentSessionWorkbook,
    writeAgentSessionWorkbookFile,
    type AgentSessionTarget,
    type AgentSessionWorkbookFile,
} from '@akohn/dashql/platform/session/agent_session_client';
import type { AgentSessionState } from '@akohn/dashql/platform/session/agent_session_state';
import type { SessionWorkbook } from '@akohn/dashql/platform/session/session_folder';
import { STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE, STORAGE_WORKBOOKS_FOLDER } from '@akohn/dashql/platform/storage/storage_backend';
import { getOPFSRoot } from '@akohn/dashql/platform/opfs_root';
import { stringifyError, type Logger } from '@akohn/dashql/platform/logger/logger';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { Runtime } from '@akohn/dashql/runtime/runtime';


const LOG_CTX = 'agent_session';

/// The catalog file of a connection in a workbook folder, the file of a published workbook
export function catalogRelationsPath(connectionId: string): string {
    return `connections/${connectionId}/dashql-catalog-relations.sql`;
}

/// A script of the copy of a workbook, `scripts/<name>.sql`, as the page takes it
const COPY_SCRIPT = new RegExp(`^${STORAGE_SCRIPTS_FOLDER}/([^/]+\\.sql)$`);
/// How long the page waits after an edit before it writes the changed scripts into the copy
const PUSH_DELAY_MS = 500;

/// The stamps of the files of the copy of a workbook by their paths
function stampsOf(workbook: SessionWorkbook): Map<string, string> {
    return new Map(workbook.files.map(file => [file.path, `${file.size}:${file.mtimeMs}`]));
}

/// The scripts of a copy that changed since the page saw it last, in the order of the files
export function changedCopyScripts(seen: ReadonlyMap<string, string>, workbook: SessionWorkbook): string[] {
    return [...stampsOf(workbook)].filter(([path, stamp]) => COPY_SCRIPT.test(path) && seen.get(path) !== stamp).map(([path]) => path);
}

/// The catalog of a connection that the agent may use, written into the copies as the catalog file of the connection
export interface CopyCatalog {
    /// Changes when the catalog of the connection changed
    stamp: string;
    /// The text of its file
    text: () => string;
}

/// A script of a workbook of the page
export interface PageScript {
    scriptKey: number;
    text: string;
    /// The connection that the script runs on
    connectionId: string;
}

/// The connections that the workbook file of a copy names for its scripts, by file name
export function copyScriptConnections(workbookFile: string): Map<string, string> {
    const connections = new Map<string, string>();
    try {
        const workbook = JSON.parse(workbookFile) as { scripts?: unknown };
        for (const script of Array.isArray(workbook.scripts) ? workbook.scripts as Record<string, unknown>[] : []) {
            if (typeof script?.name === 'string' && typeof script.connectionId === 'string') connections.set(script.name, script.connectionId);
        }
    } catch {
        // A workbook file that the agent is writing, the next stamp reads it again
    }
    return connections;
}

/// The order of the scripts of the workbook file of a copy, by their file names, empty while the agent writes it
export function copyScriptOrder(workbookFile: string): string[] {
    try {
        const workbook = JSON.parse(workbookFile) as { scripts?: unknown };
        return (Array.isArray(workbook.scripts) ? workbook.scripts as Record<string, unknown>[] : [])
            .flatMap(script => typeof script?.name === 'string' ? [script.name] : []);
    } catch {
        return [];
    }
}

/// The scripts of the page by their names in a copy, in the order of the page: a script that the page created for a
/// new script of the agent has the name of the copy
function copyNamesOf(scripts: Map<string, PageScript>, copy: Pick<Copy, 'created'>): Map<string, PageScript> {
    const copyNames = new Map<number, string>();
    for (const [fileName, key] of copy.created) copyNames.set(key, fileName);
    const names = new Map<string, PageScript>();
    for (const [fileName, script] of scripts) names.set(copyNames.get(script.scriptKey) ?? fileName, script);
    return names;
}

/// What the page does with the copies, the tests pass their own
export interface AgentSessionCopyHost {
    /// The files of the folder of a workbook of the page, after its pending writes; null for a workbook without a
    /// folder in OPFS, e.g. a native one
    readFolder: (workbookId: string) => Promise<AgentSessionWorkbookFile[] | null>;
    /// The workbook file of a workbook of the page, after its pending writes
    readWorkbookFile: (workbookId: string) => Promise<string | null>;
    /// Replace the copy of a workbook with files
    writeCopy: (workbookId: string, files: AgentSessionWorkbookFile[]) => Promise<void>;
    /// Write or remove a file of the copy
    writeFile: (workbookId: string, path: string, text: string) => Promise<void>;
    deleteFile: (workbookId: string, path: string) => Promise<void>;
    /// The text of a file of a copy
    fetchText: (workbookId: string, path: string) => Promise<string>;
    /// The scripts of a workbook of the page by file name in the order of the feed, null for a workbook that the page
    /// doesn't have
    scripts: (workbookId: string) => Map<string, PageScript> | null;
    /// Call the listener when the scripts of a workbook of the page or the connections may have changed
    subscribe: (workbookId: string, listener: () => void) => () => void;
    /// The catalogs of the connections that the agent may use, by connection id
    catalogs: () => Map<string, CopyCatalog>;
    /// Set the text of a script to the one of the agent
    setScriptText: (workbookId: string, scriptKey: number, text: string) => void;
    /// Create a script with a text, on a connection or on the connection of its neighbors, returns its key
    createScript: (workbookId: string, base: string, text: string, connectionId: string | null) => number | null;
    /// Move a script to a connection, false if the page doesn't have the connection
    setScriptConnection: (workbookId: string, scriptKey: number, connectionId: string) => boolean;
    /// Order the scripts of a workbook by their file names, the ones that the order leaves out keep their places
    reorderScripts: (workbookId: string, order: string[]) => void;
    /// Wait for a time, the tests run it at once
    delay: (ms: number) => Promise<void>;
}

/// The stamp of the catalog of a connection: its relations entry and its updates that finished
function catalogStamp(connection: ConnectionState): string {
    const updates = connection.catalogUpdates;
    const last = updates.tasksFinished.at(-1);
    return `${connection.catalogRelationEntryId}:${updates.described}:${updates.tasksFinished.length}:${last?.taskId ?? ''}:${last?.status ?? ''}`;
}

/// The host of the copies of a page over the runtime and the server of the session. `agentConnections` are the ids of
/// the connections that the agent may use, their catalogs go into the copies.
export function agentSessionCopyHost(runtime: Runtime, target: AgentSessionTarget, agentConnections: () => string[] = () => []): AgentSessionCopyHost {
    const folderOf = async (workbookId: string) =>
        await (await (await getOPFSRoot()).getDirectoryHandle(STORAGE_WORKBOOKS_FOLDER)).getDirectoryHandle(workbookId);
    const refsOf = (workbookId: string) => Object.values(runtime.store.get('workbook', workbookId)?.scriptRefs ?? {});
    return {
        readFolder: async workbookId => {
            await runtime.storage.flushWorkbook(workbookId);
            let folder: FileSystemDirectoryHandle;
            try {
                folder = await folderOf(workbookId);
            } catch {
                return null;
            }
            return await readWorkbookFolderFiles(folder);
        },
        readWorkbookFile: async workbookId => {
            await runtime.storage.flushWorkbook(workbookId);
            try {
                return await (await (await folderOf(workbookId)).getFileHandle(STORAGE_WORKBOOK_FILE)).getFile().then(file => file.text());
            } catch {
                return null;
            }
        },
        writeCopy: (workbookId, files) => writeAgentSessionWorkbook(target, workbookId, files),
        writeFile: (workbookId, path, text) => writeAgentSessionWorkbookFile(target, workbookId, { path, content: text }),
        deleteFile: (workbookId, path) => deleteAgentSessionWorkbookFile(target, workbookId, path),
        fetchText: (workbookId, path) => readAgentSessionWorkbookText(target, workbookId, path),
        scripts: workbookId => {
            const workbook = runtime.store.get('workbook', workbookId);
            if (workbook == null) return null;
            const scripts = new Map<string, PageScript>();
            workbook.scriptOrder.forEach((fileName, index) => {
                const ref = workbook.scriptRefs[fileName];
                const script = ref == null ? null : runtime.store.get('script', ref.scriptId);
                const connectionId = workbook.scriptConnections[index] ?? '';
                if (ref != null && script != null) scripts.set(fileName, { scriptKey: ref.scriptId, text: script.scriptSession.getText(), connectionId });
            });
            return scripts;
        },
        subscribe: (workbookId, listener) => {
            const scripts = runtime.store.subscribeKind('script', listener);
            const workbook = runtime.store.subscribe('workbook', workbookId, listener);
            const connections = runtime.store.subscribeKind('connection', listener);
            return () => {
                scripts();
                workbook();
                connections();
            };
        },
        catalogs: () => {
            const catalogs = new Map<string, CopyCatalog>();
            for (const connectionId of agentConnections()) {
                const connection = runtime.store.get('connection', connectionId) as ConnectionState | null;
                if (connection == null) continue;
                // The core renders the file, as it writes it into the storage of the connection
                catalogs.set(connectionId, { stamp: catalogStamp(connection), text: () => runtime.catalogRelationsFile(connectionId) ?? '' });
            }
            return catalogs;
        },
        setScriptText: (workbookId, scriptKey, text) => {
            runtime.dispatch({ workbook: workbookId }, { kind: 'setScriptText', value: { scriptKey, text } });
        },
        createScript: (workbookId, base, text, connectionId) => {
            const before = new Set(refsOf(workbookId).map(ref => ref.scriptId));
            // A connection that the page doesn't have leaves the script on the connection of its neighbors. The agent
            // tells no place, the script goes by what it reads and what reads it.
            const known = connectionId != null && runtime.store.get('connection', connectionId) != null;
            const value = { text, base, byReferences: true };
            runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: known ? { ...value, connectionId } : value });
            runtime.flush();
            return refsOf(workbookId).find(ref => !before.has(ref.scriptId))?.scriptId ?? null;
        },
        setScriptConnection: (workbookId, scriptKey, connectionId) => {
            const workbook = runtime.store.get('workbook', workbookId);
            const fileName = Object.entries(workbook?.scriptRefs ?? {}).find(([, ref]) => ref.scriptId === scriptKey)?.[0];
            if (fileName == null || runtime.store.get('connection', connectionId) == null) return false;
            runtime.dispatch({ workbook: workbookId }, { kind: 'setScriptConnection', value: { fileName, connectionId } });
            return true;
        },
        reorderScripts: (workbookId, order) => {
            runtime.dispatch({ workbook: workbookId }, { kind: 'reorderScripts', value: { order } });
        },
        delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
    };
}

/// A workbook of the page that the session has a copy of
interface Copy {
    /// The stamps of the files of the copy as the page saw them last, null until the state names the copy that the
    /// page wrote
    seen: Map<string, string> | null;
    /// The texts of the scripts that the copy holds, as far as the page knows, by file name
    texts: Map<string, string>;
    /// The scripts that the page created for new scripts of the copy, by their file names in the copy
    created: Map<string, number>;
    /// The order of the scripts that the page wrote into the workbook file of the copy last, null before it wrote one
    order: string | null;
    /// The stamps of the catalogs that the copy holds, by connection id
    catalogs: Map<string, string>;
    /// Stop watching the scripts of the page
    unsubscribe: () => void;
    /// Is a push scheduled?
    pushing: boolean;
    /// Did the page write the copy before a reload? The first state then tells what the copy holds.
    adopted: boolean;
}

/// The copies of the workbooks of a page in a session (docs/design/agent_session.md). The page writes a workbook into the
/// folder of the session once, then both sides change it: the scripts that the agent changes in the copy come into the
/// workbook of the page with their text, a new script as a script of the workbook; the scripts that the user changes
/// in the page go into the copy, the page stays the truth. The page runs the scripts for the agent
/// (agent_session_runs.ts). Not yet: scripts that the agent deletes or renames, the workbook file and the attachments
/// of the copy.
export class AgentSessionCopies {
    private readonly copies = new Map<string, Copy>();
    /// The workbooks that were copied or adopted, also the ones without a copy
    private readonly known = new Set<string>();
    /// The changes apply one after the other, in both directions
    private queue: Promise<void> = Promise.resolve();
    private disposed = false;
    /// Does the user have the workbooks? The changes of the agent then wait, the latest state is taken on resume.
    private paused = false;
    private pausedState: AgentSessionState | null = null;

    constructor(private readonly host: AgentSessionCopyHost, private readonly logger: Logger) { }

    private enqueue(what: string, workbookId: string, task: () => Promise<void>): Promise<void> {
        this.queue = this.queue.then(task).catch(error => {
            this.logger.warn(`Cannot ${what}`, { workbook: workbookId, error: stringifyError(error) }, LOG_CTX);
        });
        return this.queue;
    }

    /// Was a workbook copied or adopted?
    has(workbookId: string): boolean {
        return this.known.has(workbookId);
    }

    /// Follow the copy that the page wrote before a reload: the first state that names it tells what it holds, its
    /// scripts that differ from the page are changes of the agent
    adopt(workbookId: string): void {
        this.known.add(workbookId);
        this.copies.set(workbookId, { seen: null, texts: new Map(), created: new Map(), order: null, catalogs: new Map(), unsubscribe: () => { }, pushing: false, adopted: true });
    }

    /// Write a workbook of the page into the session, replacing an older copy, and follow it from then on. Resolves
    /// when the copy was written, rejects when it failed.
    async copy(workbookId: string): Promise<void> {
        this.known.add(workbookId);
        this.copies.get(workbookId)?.unsubscribe();
        this.copies.delete(workbookId);
        const files = await this.host.readFolder(workbookId);
        if (files == null || this.disposed) return;
        const texts = new Map<string, string>();
        for (const file of files) {
            const match = COPY_SCRIPT.exec(file.path);
            if (match != null) texts.set(match[1], typeof file.content === 'string' ? file.content : await new Blob([file.content]).text());
        }
        // The copy holds the workbook file of the page with its order
        const order = [...(this.host.scripts(workbookId)?.keys() ?? [])].join('\n');
        const copy: Copy = { seen: null, texts, created: new Map(), order, catalogs: new Map(), unsubscribe: () => { }, pushing: false, adopted: false };
        this.copies.set(workbookId, copy);
        await this.host.writeCopy(workbookId, files);
        if (this.disposed || this.copies.get(workbookId) !== copy) return;
        this.watch(workbookId, copy);
        this.logger.info('Copied the workbook into the session', { workbook: workbookId, files: String(files.length) }, LOG_CTX);
    }

    /// Hold the changes of the agent while the user has the workbooks (the prompt in SQL), and take what the agent
    /// changed meanwhile when the agent gets them back. The changes of the user go into the copies either way, a script
    /// that both changed keeps the text of the user.
    pause(paused: boolean): Promise<void> {
        if (this.paused === paused) return this.queue;
        this.paused = paused;
        const state = this.pausedState;
        this.pausedState = null;
        return !paused && state != null ? this.update(state) : this.queue;
    }

    /// Take a state of the session, resolves when the changes of the agent were applied
    update(state: AgentSessionState): Promise<void> {
        if (this.paused) {
            this.pausedState = state;
            return this.queue;
        }
        for (const workbook of state.workbooks ?? []) {
            const copy = this.copies.get(workbook.workbookId);
            if (copy == null) continue;
            const seen = copy.seen;
            copy.seen = stampsOf(workbook);
            if (seen == null && copy.adopted) {
                // Every script of the copy that differs from the page is a change of the agent, the page writes its
                // own changes once it knows them
                for (const path of changedCopyScripts(new Map(), workbook)) {
                    this.enqueue('take a script of the agent', workbook.workbookId, () => this.take(workbook.workbookId, copy, path));
                }
                void this.enqueue('follow the copy', workbook.workbookId, async () => {
                    if (this.copies.get(workbook.workbookId) === copy && !this.disposed) this.watch(workbook.workbookId, copy);
                });
                continue;
            }
            // The first state that names the copy is what the page wrote
            if (seen == null) continue;
            for (const path of changedCopyScripts(seen, workbook)) {
                this.enqueue('take a script of the agent', workbook.workbookId, () => this.take(workbook.workbookId, copy, path));
            }
            // The agent names the connections and the order of the scripts in the workbook file
            const workbookFile = copy.seen.get(STORAGE_WORKBOOK_FILE);
            if (workbookFile != null && seen.get(STORAGE_WORKBOOK_FILE) !== workbookFile) {
                this.enqueue('take the workbook file of the agent', workbook.workbookId, () => this.takeWorkbookFile(workbook.workbookId, copy));
            }
        }
        return this.queue;
    }

    /// Stop following the copies
    dispose(): void {
        this.disposed = true;
        for (const copy of this.copies.values()) copy.unsubscribe();
        this.copies.clear();
        this.known.clear();
    }

    /// The changes of the page settled, resolves when they are in the copies
    settled(): Promise<void> {
        return this.queue;
    }

    /// Take a script that the agent changed in the copy
    private async take(workbookId: string, copy: Copy, path: string): Promise<void> {
        const text = await this.host.fetchText(workbookId, path);
        const scripts = this.host.scripts(workbookId);
        if (scripts == null || this.copies.get(workbookId) !== copy) return;
        const fileName = path.slice(STORAGE_SCRIPTS_FOLDER.length + 1);
        // The copy holds it now, the page doesn't write it back
        copy.texts.set(fileName, text);
        const createdKey = copy.created.get(fileName);
        const script = scripts.get(fileName) ?? [...scripts.values()].find(other => other.scriptKey === createdKey);
        if (script != null) {
            if (script.text !== text) this.host.setScriptText(workbookId, script.scriptKey, text);
            return;
        }
        // A new script runs on the connection that the workbook file of the copy names for it
        let connectionId: string | null = null;
        try {
            connectionId = copyScriptConnections(await this.host.fetchText(workbookId, STORAGE_WORKBOOK_FILE)).get(fileName) ?? null;
        } catch {
            // No workbook file, the script takes the connection of its neighbors
        }
        if (this.copies.get(workbookId) !== copy) return;
        const key = this.host.createScript(workbookId, fileName.replace(/\.sql$/, ''), text, connectionId);
        if (key != null) copy.created.set(fileName, key);
    }

    /// Move the scripts of the page to the connections that the agent named for them in the workbook file of the copy,
    /// and into its order
    private async takeWorkbookFile(workbookId: string, copy: Copy): Promise<void> {
        const workbookFile = await this.host.fetchText(workbookId, STORAGE_WORKBOOK_FILE);
        const connections = copyScriptConnections(workbookFile);
        const scripts = this.host.scripts(workbookId);
        if (scripts == null || this.copies.get(workbookId) !== copy) return;
        // The scripts of the copy by the names of the page, a script that the page created for the agent may have
        // another one
        const pageNames = new Map<string, string>();
        for (const fileName of scripts.keys()) pageNames.set(fileName, fileName);
        for (const [fileName, key] of copy.created) {
            const created = [...scripts].find(([, script]) => script.scriptKey === key);
            if (created != null) pageNames.set(fileName, created[0]);
        }
        const copyOrder = copyScriptOrder(workbookFile);
        const order = copyOrder.flatMap(fileName => pageNames.get(fileName) ?? []);
        if (order.length > 0) this.host.reorderScripts(workbookId, order);
        // A workbook file that names every script in the new order of the page holds it already, the page doesn't
        // write it again over a later change of the agent
        const reordered = [...copyNamesOf(this.host.scripts(workbookId) ?? scripts, copy).keys()].join('\n');
        if (copyOrder.join('\n') === reordered) copy.order = reordered;
        for (const [fileName, connectionId] of connections) {
            const createdKey = copy.created.get(fileName);
            const script = scripts.get(fileName) ?? [...scripts.values()].find(other => other.scriptKey === createdKey);
            if (script == null || script.connectionId === connectionId) continue;
            if (!this.host.setScriptConnection(workbookId, script.scriptKey, connectionId)) {
                this.logger.warn('The agent named a connection that the page does not have', { workbook: workbookId, script: fileName, connection: connectionId }, LOG_CTX);
            }
        }
    }

    /// Write the changes of the page into the copy from now on
    private watch(workbookId: string, copy: Copy): void {
        copy.unsubscribe = this.host.subscribe(workbookId, () => this.schedulePush(workbookId, copy));
        // An edit before
        this.schedulePush(workbookId, copy);
    }

    private schedulePush(workbookId: string, copy: Copy): void {
        if (copy.pushing || this.disposed) return;
        copy.pushing = true;
        void this.host.delay(PUSH_DELAY_MS).then(() => {
            copy.pushing = false;
            return this.enqueue('write the scripts of the page into the session', workbookId, () => this.push(workbookId, copy));
        });
    }

    /// Write the scripts that the page changed into the copy, and remove the ones that it deleted
    private async push(workbookId: string, copy: Copy): Promise<void> {
        const scripts = this.host.scripts(workbookId);
        if (scripts == null || this.copies.get(workbookId) !== copy) return;
        const names = copyNamesOf(scripts, copy);
        // A new order of the page goes into the workbook file of the copy, also one of the user. A copy that the page
        // adopted holds the order that the page wrote before the reload.
        const order = [...names.keys()].join('\n');
        let listChanged = copy.order != null && copy.order !== order;
        copy.order = order;
        for (const [fileName, script] of names) {
            if (copy.texts.get(fileName) === script.text) continue;
            listChanged ||= !copy.texts.has(fileName);
            copy.texts.set(fileName, script.text);
            await this.host.writeFile(workbookId, `${STORAGE_SCRIPTS_FOLDER}/${fileName}`, script.text);
        }
        for (const fileName of [...copy.texts.keys()]) {
            if (names.has(fileName)) continue;
            listChanged = true;
            copy.texts.delete(fileName);
            await this.host.deleteFile(workbookId, `${STORAGE_SCRIPTS_FOLDER}/${fileName}`);
        }
        // The workbook file lists the scripts
        if (listChanged) {
            const workbookFile = await this.host.readWorkbookFile(workbookId);
            if (workbookFile != null) await this.host.writeFile(workbookId, STORAGE_WORKBOOK_FILE, workbookFile);
        }
        // The catalogs of the connections that the agent may use, `dashql catalog` reads them
        for (const [connectionId, catalog] of this.host.catalogs()) {
            if (copy.catalogs.get(connectionId) === catalog.stamp) continue;
            copy.catalogs.set(connectionId, catalog.stamp);
            const path = catalogRelationsPath(connectionId);
            const text = catalog.text();
            // A copy that the page wrote before a reload holds the catalogs already
            if (copy.adopted && copy.seen?.has(path) && await this.host.fetchText(workbookId, path).catch(() => null) === text) continue;
            await this.host.writeFile(workbookId, path, text);
        }
    }
}
