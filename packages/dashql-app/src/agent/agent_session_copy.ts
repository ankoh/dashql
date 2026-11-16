import {
    deleteAgentSessionWorkbookFile,
    readAgentSessionResult,
    readAgentSessionWorkbookText,
    readWorkbookFolderFiles,
    writeAgentSessionWorkbook,
    writeAgentSessionWorkbookFile,
    type AgentSessionTarget,
    type AgentSessionWorkbookFile,
} from '@ankoh/dashql/platform/session/agent_session_client';
import type { AgentSessionState } from '@ankoh/dashql/platform/session/agent_session_state';
import { workbookCopyPath, type SessionWorkbook } from '@ankoh/dashql/platform/session/workbook_journal';
import { STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE, STORAGE_WORKBOOKS_FOLDER } from '@ankoh/dashql/platform/storage/storage_backend';
import { getOPFSRoot } from '@ankoh/dashql/platform/opfs_root';
import { stringifyError, type Logger } from '@ankoh/dashql/platform/logger/logger';
import type { Runtime } from '@ankoh/dashql/runtime/runtime';

const LOG_CTX = 'agent_session';

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

/// A script of a workbook of the page
export interface PageScript {
    scriptKey: number;
    text: string;
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
    /// The scripts of a workbook of the page by file name, null for a workbook that the page doesn't have
    scripts: (workbookId: string) => Map<string, PageScript> | null;
    /// Call the listener when the scripts of a workbook of the page may have changed
    subscribe: (workbookId: string, listener: () => void) => () => void;
    /// Stage a new text of a script as a rewrite to accept or reject
    rewriteScript: (workbookId: string, scriptKey: number, text: string) => void;
    /// Create a script with a text, returns its key
    createScript: (workbookId: string, base: string, text: string) => number | null;
    /// Fetch the result of a key from the session and add it to the query result cache of the page, resolves whether
    /// it was added
    importResult: (key: string) => Promise<boolean>;
    /// Wait for a time, the tests run it at once
    delay: (ms: number) => Promise<void>;
}

/// The host of the copies of a page over the runtime and the server of the session
export function agentSessionCopyHost(runtime: Runtime, target: AgentSessionTarget): AgentSessionCopyHost {
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
            for (const [fileName, ref] of Object.entries(workbook.scriptRefs)) {
                const script = runtime.store.get('script', ref.scriptId);
                if (script != null) scripts.set(fileName, { scriptKey: ref.scriptId, text: script.scriptSession.getText() });
            }
            return scripts;
        },
        subscribe: (workbookId, listener) => {
            const scripts = runtime.store.subscribeKind('script', listener);
            const workbook = runtime.store.subscribe('workbook', workbookId, listener);
            return () => {
                scripts();
                workbook();
            };
        },
        rewriteScript: (workbookId, scriptKey, text) => {
            runtime.dispatch({ workbook: workbookId }, { kind: 'setScriptText', value: { scriptKey, text, withDiff: true } });
        },
        createScript: (workbookId, base, text) => {
            const before = new Set(refsOf(workbookId).map(ref => ref.scriptId));
            runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text, base } });
            runtime.flush();
            return refsOf(workbookId).find(ref => !before.has(ref.scriptId))?.scriptId ?? null;
        },
        importResult: async key => await runtime.importCachedResult(key, await readAgentSessionResult(target, key)),
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
    /// Stop watching the scripts of the page
    unsubscribe: () => void;
    /// Is a push scheduled?
    pushing: boolean;
    /// Did the page write the copy before a reload? The first state then tells what the copy holds.
    adopted: boolean;
}

/// The key of a result in the query result cache, as the journal names it
const RESULT_KEY = /^[0-9a-f]{64}$/;

/// The copies of the workbooks of a page in a session (docs/wip/agent_session.md). The page writes a workbook into the
/// folder of the session once, then both sides change it: the scripts that the agent changes in the copy come into the
/// workbook of the page, a changed script staged as a rewrite that the user accepts or rejects, a new script as a
/// script of the workbook; the scripts that the user changes in the page go into the copy, the page stays the truth.
/// The results of the runs of the agent go into the query result cache of the page. Not yet: scripts that the agent
/// deletes or renames, the workbook file and the attachments of the copy.
export class AgentSessionCopies {
    private readonly copies = new Map<string, Copy>();
    /// The workbooks that were copied or adopted, also the ones without a copy
    private readonly known = new Set<string>();
    /// The keys of the results of the agent that the page imported or is importing
    private readonly results = new Set<string>();
    /// The changes apply one after the other, in both directions
    private queue: Promise<void> = Promise.resolve();
    private disposed = false;

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
        this.copies.set(workbookId, { seen: null, texts: new Map(), created: new Map(), unsubscribe: () => { }, pushing: false, adopted: true });
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
        const copy: Copy = { seen: null, texts, created: new Map(), unsubscribe: () => { }, pushing: false, adopted: false };
        this.copies.set(workbookId, copy);
        await this.host.writeCopy(workbookId, files);
        if (this.disposed || this.copies.get(workbookId) !== copy) return;
        this.watch(workbookId, copy);
        this.logger.info('Copied the workbook into the session', { workbook: workbookId, files: String(files.length) }, LOG_CTX);
    }

    /// Take a state of the session, resolves when the changes of the agent were applied
    update(state: AgentSessionState): Promise<void> {
        for (const workbook of state.workbooks ?? []) {
            const copy = this.copies.get(workbook.workbookId);
            if (copy == null || workbook.path !== workbookCopyPath(workbook.workbookId)) continue;
            // The results of the runs of the agent go into the query result cache of the page, the scripts with
            // their keys show them
            for (const result of workbook.results ?? []) {
                const key = result.key;
                if (key == null || !RESULT_KEY.test(key) || this.results.has(key)) continue;
                this.results.add(key);
                void this.enqueue('take a result of the agent', workbook.workbookId, async () => {
                    await this.host.importResult(key);
                });
            }
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
            if (script.text !== text) this.host.rewriteScript(workbookId, script.scriptKey, text);
            return;
        }
        const key = this.host.createScript(workbookId, fileName.replace(/\.sql$/, ''), text);
        if (key != null) copy.created.set(fileName, key);
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
        // The scripts of the copy that the page created for the agent have the names of the copy
        const names = new Map<string, PageScript>(scripts);
        for (const [fileName, key] of copy.created) {
            const created = [...scripts].find(([, script]) => script.scriptKey === key);
            if (created != null && created[0] !== fileName) {
                names.delete(created[0]);
                names.set(fileName, created[1]);
            }
        }
        let listChanged = false;
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
    }
}
