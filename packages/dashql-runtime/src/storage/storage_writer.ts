import * as core from '@ankoh/dashql-core';
import * as Immutable from 'immutable';

import { Logger, stringifyError } from '../platform/logger/logger.js';
import { VariantKind } from '../utils/variant.js';
import type { StorageBackend, WorkbookData, WorkbookCloudLink, WorkbookConnection, ConnectionEntry, ConnectionParams, WorkbookRegistryBackend, WorkbookScript } from './storage_backend.js';
import { STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE, STORAGE_CONNECTIONS_FOLDER, isWorkbookRegistryBackend } from './storage_backend.js';
import { WORKBOOK_FORMAT_VERSION } from './migration/versions.js';
import { workbookAttachments } from './workbook_files.js';

const LOG_CTX = 'storage_writer';

/// Order-independent deep equality for plain JSON values (objects, arrays, primitives).
/// Workbook manifests are plain JSON (no Dates/Maps/functions), so this is sufficient.
function jsonDeepEqual(a: any, b: any): boolean {
    if (a === b) {
        return true;
    }
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        return false;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return false;
        }
        return a.every((v, i) => jsonDeepEqual(v, b[i]));
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }
    return aKeys.every(k => Object.prototype.hasOwnProperty.call(b, k) && jsonDeepEqual(a[k], b[k]));
}

/// Compare the manifest fields the writer owns (formatVersion, workbookId, name, connections, scripts, attachments, metadata).
/// Other fields (storageType/nativePath/workbookPath) are display- or registry-only and are not
/// written into the workbook file, so they're deliberately ignored.
///
/// Both sides are round-tripped through JSON first so this compares exactly what would be
/// persisted: serialization drops `undefined`-valued keys, so a freshly built params object with
/// `{ foo: undefined }` must compare equal to the reloaded `{}` it serializes to.
function workbookManifestEquals(a: WorkbookData, b: WorkbookData): boolean {
    const project = (s: WorkbookData) => JSON.parse(JSON.stringify({
        formatVersion: s.formatVersion,
        workbookId: s.workbookId,
        name: s.name,
        connections: s.connections,
        scripts: s.scripts,
        attachments: s.attachments,
        metadata: s.metadata,
    }));
    return jsonDeepEqual(project(a), project(b));
}

export const DEBOUNCE_DURATION_WORKBOOK_WRITE = 100;
export const DEBOUNCE_DURATION_SCRIPT_WRITE = 100;

export const WRITE_WORKBOOK_MANIFEST = Symbol('WRITE_WORKBOOK_MANIFEST');
export const WRITE_WORKBOOK_PROPERTIES = Symbol('WRITE_WORKBOOK_PROPERTIES');

/// The workbook fields that are owned by the user, not derived from scripts or connections.
/// They are written together since writes of the same manifest replace each other while debounced.
export interface WorkbookProperties {
    /// The workbook name, null if the user never named the workbook
    name: string | null;
    /// Does the workbook stay ephemeral? A write without it promotes the workbook
    ephemeral?: boolean;
    /// The published workbook of the cloud that the workbook is linked to, a write without it removes the link
    cloud?: WorkbookCloudLink;
}
/// A workbook that is written as a whole, its scripts first and its manifest last
export interface WorkbookReplacement {
    /// The workbook id
    workbookId: string;
    /// The workbook name, null keeps the name on disk
    name: string | null;
    /// The script files, their text is read when the write runs. The script list of the workbook file
    /// is written by `WRITE_WORKBOOK_SCRIPTS` alone, it is the only writer of the list.
    scripts: Array<{ fileName: string; readText: () => string }>;
    /// A connection of a workbook that is not stored yet, the script list follows with the others
    connection: WorkbookConnection | null;
    /// The file name the workbook was created from, if any
    originalFileName: string | undefined;
}
export const REPLACE_WORKBOOK_SCRIPTS = Symbol('REPLACE_WORKBOOK_SCRIPTS');
export const WRITE_CONNECTION_ENTRY = Symbol('WRITE_CONNECTION_ENTRY');
export const DELETE_CONNECTION_ENTRY = Symbol('DELETE_CONNECTION_ENTRY');
export const WRITE_CONNECTION_FILE = Symbol('WRITE_CONNECTION_FILE');
export const PATCH_WORKBOOK_CONNECTION = Symbol('PATCH_WORKBOOK_CONNECTION');
export const WRITE_SCRIPT = Symbol('WRITE_SCRIPT');
export const DELETE_SCRIPT = Symbol('DELETE_SCRIPT');
export const RENAME_SCRIPT = Symbol('RENAME_SCRIPT');
export const WRITE_WORKBOOK_SCRIPTS = Symbol('WRITE_WORKBOOK_SCRIPTS');
export const REFRESH_WORKBOOK_ATTACHMENTS = Symbol('REFRESH_WORKBOOK_ATTACHMENTS');

/// The script list of a workbook
export interface WorkbookScriptList {
    /// The scripts in feed order with their connections
    scripts: WorkbookScript[];
    /// Copies of the connections of the scripts that the workbook file may not hold yet
    connections: WorkbookConnection[];
}

export type StorageWriteTaskVariant =
    | VariantKind<typeof WRITE_WORKBOOK_MANIFEST, [string, WorkbookConnection[]] | [string, WorkbookConnection[], { ephemeral: boolean }]>
    | VariantKind<typeof WRITE_WORKBOOK_PROPERTIES, [string, WorkbookProperties]>
    | VariantKind<typeof REPLACE_WORKBOOK_SCRIPTS, WorkbookReplacement>
    | VariantKind<typeof WRITE_CONNECTION_ENTRY, ConnectionEntry>
    | VariantKind<typeof DELETE_CONNECTION_ENTRY, string>
    /// The text of a file, or how to read it when the write runs, null if there is nothing to write anymore
    | VariantKind<typeof WRITE_CONNECTION_FILE, [string, string, string | (() => string | null)]>
    | VariantKind<typeof PATCH_WORKBOOK_CONNECTION, [string, WorkbookConnection] | [string, WorkbookConnection, string[]]>
    | VariantKind<typeof WRITE_SCRIPT, [string, string, string]>
    | VariantKind<typeof DELETE_SCRIPT, [string, string]>
    | VariantKind<typeof RENAME_SCRIPT, [string, string, string]>
    | VariantKind<typeof WRITE_WORKBOOK_SCRIPTS, [string, WorkbookScriptList]>
    | VariantKind<typeof REFRESH_WORKBOOK_ATTACHMENTS, string>
    ;

/// The key of a write. Writes with the same key coalesce, the latest task wins.
///
/// Keys are logical paths, they are not the paths of the files:
///   - Workbook keys start with the workbook UUID, e.g. `<workbookId>/scripts/01_query.sql`. The
///     per-workbook operations (pause, pending writes, cancellation) select keys by this prefix.
///   - Keys of the app storage start with `@`, e.g. `@manifest/connections/<id>` for a connection
///     entry of the app manifest and `@connections/<id>/<file>` for the files of a connection in
///     `connections/<id>/`. A UUID never starts with `@`, so these keys never match the prefix of a
///     workbook and are never paused or cancelled with one. `storageWriteChainKey` orders them.
export type StorageWriteKey = string;
/// The manifest is keyed on its real file path (`<workbookId>/dashql-workbook.json`) so the key it is
/// *scheduled* under matches the path its *completed* write is recorded under — otherwise the manifest
/// shows up as two rows in the stats view (a phantom `<workbookId>/` schedule row plus the real
/// file's write row). Keying both on the file also means a scheduled-but-not-yet-flushed manifest
/// write coalesces onto the same statistics row as its completion.
export const groupWorkbookManifestWrites = (workbookId: string) => `${workbookId}/${STORAGE_WORKBOOK_FILE}`;
export const groupWorkbookWrites = (workbookId: string) => `${workbookId}/${STORAGE_SCRIPTS_FOLDER}`;
/// The connection entries are written into the app manifest, one key per connection.
export const groupConnectionEntryWrites = (connectionId: string) => `@manifest/${STORAGE_CONNECTIONS_FOLDER}/${connectionId}`;
/// The files of a connection, e.g. its catalog relations
export const groupConnectionFileWrites = (connectionId: string, fileName: string) => `@${STORAGE_CONNECTIONS_FOLDER}/${connectionId}/${fileName}`;
/// The copy of a connection's params in a workbook. Copies of different connections must not
/// coalesce, but they serialize with every other write of the workbook.
export const groupWorkbookConnectionCopyWrites = (workbookId: string, connectionId: string) => `${workbookId}/${STORAGE_WORKBOOK_FILE}:connection/${connectionId}`;
/// The script list of a workbook and the connections it uses. It is patched into the workbook file and
/// must not coalesce with the other writes of the workbook file.
export const groupWorkbookScriptListWrites = (workbookId: string) => `${workbookId}/${STORAGE_WORKBOOK_FILE}:scripts`;
/// The attachment list of a workbook
export const groupWorkbookAttachmentListWrites = (workbookId: string) => `${workbookId}/${STORAGE_WORKBOOK_FILE}:attachments`;
/// A cached query result of a workbook and the marker of its last access
export const groupScriptWrites = (workbookId: string, fileName: string) =>
    `${workbookId}/${STORAGE_SCRIPTS_FOLDER}/${fileName}`;
export const groupScriptDeletes = (workbookId: string, scriptName: string) =>
    `${workbookId}/${STORAGE_SCRIPTS_FOLDER}/${scriptName}:delete`;
/// A page/script rename lives in its own `:rename` keyspace, keyed by the *source* path. Keeping it
/// off the write/delete keyspaces means a later content write (or delete) of the destination never
/// coalesces onto — and so never clobbers — a still-pending rename of the same name. The action lives
/// in a `:rename` *suffix* rather than a prefix so the key still starts with the workbook id and
/// sorts/scopes like every other file key.
export const groupScriptRenames = (workbookId: string, oldScriptName: string) =>
    `${workbookId}/${STORAGE_SCRIPTS_FOLDER}/${oldScriptName}:rename`;

/// Whether a statistics key belongs to a given workbook. Every write key is a path rooted at the
/// workbook id (`<workbookId>/…`), with the `:delete`/`:rename` action namespaces living in a suffix
/// (see the group* helpers above), so the workbook owns the key when it is the workbook id itself or a
/// descendant of it. Used to scope the storage-writer stats view to the active workbook.
export function storageWriteKeyBelongsToWorkbook(key: StorageWriteKey, workbookId: string): boolean {
    return key === workbookId || key.startsWith(`${workbookId}/`);
}

/// Strip the workbook-id prefix from a write key for display, keeping any `:delete`/`:rename` suffix
/// so the action stays legible. Once the stats view is scoped to a single workbook the workbook id is
/// redundant on every row, so e.g. `<workbookId>/scripts/page-1/01.sql` renders as
/// `scripts/page-1/01.sql` and `<workbookId>/scripts/page-1:rename` as `scripts/page-1:rename`.
/// The bare workbook key collapses to an empty string. Keys that don't belong to the workbook are
/// returned unchanged.
export function storageWriteKeyWithinWorkbook(key: StorageWriteKey, workbookId: string): string {
    if (!storageWriteKeyBelongsToWorkbook(key, workbookId)) {
        return key;
    }
    return key === workbookId ? '' : key.slice(workbookId.length + 1);
}

/// The outcome of a scheduled write
export type StorageWriteResult =
    /// The task was executed (a task may still skip writing content that is already persisted)
    | { status: 'written' }
    /// A newer task with the same key replaced the task before it was executed
    | { status: 'superseded' }
    /// The task was discarded before it was executed
    | { status: 'cancelled' }
    /// The writer or the workbook is paused, the task stays pending and is executed on resume
    | { status: 'deferred' }
    /// Executing the task failed
    | { status: 'failed'; error: unknown };

/// The chain key of a write key, tasks with the same chain key are executed one after another.
/// Workbook keys chain per workbook (`<workbookId>/…`), so mutations and their index rebuilds cannot
/// overlap. Global keys start with `@` and chain per entity
/// (`@manifest/…`, `@connections/<id>/…`). The writer of the core chains by the same rule (`storage::keys::chain_key`).
export function storageWriteChainKey(key: StorageWriteKey): string {
    const parts = key.split('/');
    if (key.startsWith('@connections/') && parts.length > 1) {
        return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
}

export interface StorageWriterStatistics {
    /// The number of writes we scheduled
    totalScheduledWrites: number;
    /// The number of writes we performed
    totalWrites: number;
    /// The number of bytes written in total to storage
    totalWrittenBytes: number;
    /// The accumulated time spent writing
    totalWriteTime: number;
    /// The last write
    lastWrite: Date | null;
}

export type StorageWriteStatisticsMap = Immutable.Map<StorageWriteKey, StorageWriterStatistics>;
export type StorageWriteStatisticsSubscriber = (stats: StorageWriteStatisticsMap) => void;

/// A workbook whose files are not available, e.g. a native folder that was moved or deleted
export class WorkbookUnavailableError extends Error {
    /// The workbook id
    readonly workbookId: string;

    constructor(workbookId: string, cause: unknown) {
        super(`workbook ${workbookId} is not available: ${stringifyError(cause)}`);
        this.name = 'WorkbookUnavailableError';
        this.workbookId = workbookId;
    }
}

/// Subscriber for scripts that changed outside the app
export type ExternalScriptChangeSubscriber = (workbookId: string) => void;

// The loader patches workbook files and connection entries with the helpers below, the writer of the core has its own
// (`storage::workbook_file`). They go when the restore moves to the core.

/// Replace the copies of a connection's params in a workbook.
/// References of the replaced connections (connections that were merged into this one) are rewritten
/// to the connection id. Returns null when the workbook doesn't reference the connection or the copies
/// are up to date.
export function patchWorkbookConnection(workbook: WorkbookData, copy: WorkbookConnection, replaced: readonly string[] = []): WorkbookData | null {
    const connectionId = copy.connectionId;
    const references = (id: string) => id === connectionId || replaced.includes(id);
    const next: WorkbookData = {
        ...workbook,
        connections: dedupeConnections(workbook.connections.map(connection =>
            references(connection.connectionId) ? copy : connection)),
        scripts: workbook.scripts.map(script => replaced.includes(script.connectionId) ? { ...script, connectionId } : script),
    };
    return workbookManifestEquals(workbook, next) ? null : next;
}

/// Drop connections that an earlier connection of the list references already.
/// Consolidated connections can turn distinct references into the same one.
export function dedupeConnections<T extends { connectionId: string }>(connections: T[]): T[] {
    const seen = new Set<string>();
    return connections.filter(connection => {
        if (seen.has(connection.connectionId)) return false;
        seen.add(connection.connectionId);
        return true;
    });
}

/// Insert or replace a connection entry, keeping its creation time
export function upsertConnectionEntry(connections: ConnectionEntry[] | undefined, entry: ConnectionEntry): ConnectionEntry[] | null {
    const entries = connections ?? [];
    const index = entries.findIndex(e => e.id === entry.id);
    const prev = index >= 0 ? entries[index] : null;
    const next: ConnectionEntry = {
        ...entry,
        ...(entry.createdAt == null && prev?.createdAt != null ? { createdAt: prev.createdAt } : {}),
    };
    if (prev != null && jsonDeepEqual(JSON.parse(JSON.stringify(prev)), JSON.parse(JSON.stringify(next)))) {
        return null;
    }
    return index >= 0 ? entries.map((e, i) => (i === index ? next : e)) : [...entries, next];
}

/// Set up the core of the storage writer
export type SetupStorageWriterCore = (context: string) => Promise<core.DashQL>;

/// A call that waits for the core
interface WaitingCall {
    run: (native: core.DashQLStorageWriter) => void;
    fail: (error: unknown) => void;
}

/// The task of a write as the writer of the core reads it
function nativeTask(task: StorageWriteTaskVariant): core.StorageWriteTask {
    switch (task.type) {
        case WRITE_WORKBOOK_MANIFEST: {
            const [workbookId, connections, created] = task.value;
            return { type: 'writeWorkbookManifest', workbookId, connections, ephemeral: created?.ephemeral === true };
        }
        case WRITE_WORKBOOK_PROPERTIES: {
            const [workbookId, { name, ephemeral, cloud }] = task.value;
            return { type: 'writeWorkbookProperties', workbookId, name, ephemeral: ephemeral === true, cloud: cloud ?? null };
        }
        case REPLACE_WORKBOOK_SCRIPTS: {
            const workbook = task.value;
            return {
                type: 'replaceWorkbookScripts',
                workbookId: workbook.workbookId,
                name: workbook.name,
                scripts: workbook.scripts.map(script => ({ fileName: script.fileName, text: () => script.readText() })),
                connection: workbook.connection,
                originalFileName: workbook.originalFileName ?? null,
            };
        }
        case WRITE_CONNECTION_ENTRY:
            return { type: 'writeConnectionEntry', entry: task.value };
        case DELETE_CONNECTION_ENTRY:
            return { type: 'deleteConnectionEntry', connectionId: task.value };
        case WRITE_CONNECTION_FILE: {
            const [connectionId, fileName, content] = task.value;
            return { type: 'writeConnectionFile', connectionId, fileName, text: typeof content === 'function' ? () => content() : content };
        }
        case PATCH_WORKBOOK_CONNECTION: {
            const [workbookId, copy, replaced] = task.value;
            return { type: 'patchWorkbookConnection', workbookId, copy, replaced: replaced ?? [] };
        }
        case WRITE_SCRIPT: {
            const [workbookId, fileName, text] = task.value;
            return { type: 'writeScript', workbookId, fileName, text };
        }
        case DELETE_SCRIPT: {
            const [workbookId, fileName] = task.value;
            return { type: 'deleteScript', workbookId, fileName };
        }
        case RENAME_SCRIPT: {
            const [workbookId, from, to] = task.value;
            return { type: 'renameScript', workbookId, from, to };
        }
        case WRITE_WORKBOOK_SCRIPTS: {
            const [workbookId, list] = task.value;
            return { type: 'writeWorkbookScripts', workbookId, scripts: list.scripts, connections: list.connections };
        }
        case REFRESH_WORKBOOK_ATTACHMENTS:
            return { type: 'refreshWorkbookAttachments', workbookId: task.value };
    }
}

/// The outcome of a write of the core as the callers know it
export function writeResultOf(outcome: core.StorageWriteOutcome): StorageWriteResult {
    if (outcome.status !== 'failed') return { status: outcome.status };
    const error = outcome.unavailableWorkbook != null ? new WorkbookUnavailableError(outcome.unavailableWorkbook, outcome.error) : outcome.error;
    return { status: 'failed', error };
}

/// The storage writer of the runtime, an adapter over the writer of the core runtime
/// (`packages/dashql-core-runtime/src/storage`).
///
/// The writer of the core decides what to write and when: the keys and their chains, debouncing, coalescing, pausing,
/// flushing, the statistics and the workbook files it patches. This adapter is its host: the storage backend, the
/// timers, the clock and the log, see `docs/wip/core_runtime.md`.
///
/// The writer is created before the core is set up, e.g. by the storage provider of the app. It takes a core that is
/// given to it or that the package instantiated already, or asks for one with the first write: the calls before it
/// wait and run in order once it is there. Until then its queries see none of them. A writer without a way to set up a
/// core instantiates the default one.
export class StorageWriter {
    /// The logger
    logger: Logger;
    /// The storage backend
    backend: StorageBackend;
    /// The writer of the core, null until the core is there
    protected native: core.DashQLStorageWriter | null = null;
    /// The calls that wait for the core
    protected waiting: WaitingCall[] = [];
    /// How to set up a core
    protected setupCore: SetupStorageWriterCore | null = null;
    /// Was a core requested?
    protected coreRequested = false;
    /// The statistics
    protected statistics: StorageWriteStatisticsMap = Immutable.Map();
    protected statisticsSubscribers = new Set<StorageWriteStatisticsSubscriber>();
    /// Subscribers for scripts that changed outside the app
    protected externalChangeSubscribers = new Set<ExternalScriptChangeSubscriber>();

    constructor(logger: Logger, backend: StorageBackend, instance: core.DashQL | SetupStorageWriterCore | null = null) {
        this.logger = logger;
        this.backend = backend;
        if (instance != null) this.provideCore(instance);
    }

    /// Give the writer a core, or how to set one up once it needs one. The runtime gives the writer of the platform
    /// the setup of the platform and the core it restores with. A writer keeps the first core it gets.
    public provideCore(instance: core.DashQL | SetupStorageWriterCore): void {
        if (this.native != null) return;
        if (typeof instance === 'function') {
            this.setupCore = instance;
            return;
        }
        this.native = instance.createStorageWriter(this.createHost(), WORKBOOK_FORMAT_VERSION);
        const waiting = this.waiting;
        this.waiting = [];
        for (const call of waiting) call.run(this.native);
    }

    /// Ask for a core, the calls that wait run once it is there
    protected requestCore(): void {
        if (this.coreRequested || this.native != null) return;
        this.coreRequested = true;
        const setup = this.setupCore;
        const request = async (): Promise<core.DashQL> => {
            if (setup != null) {
                try {
                    return await setup('storage_writer');
                } catch (e) {
                    this.logger.warn('The platform has no core for the storage writer, instantiating the default one', { error: stringifyError(e) }, LOG_CTX);
                }
            }
            return await core.DashQL.create();
        };
        request().then(instance => this.provideCore(instance), error => {
            this.logger.error('Failed to set up the core of the storage writer', { error: stringifyError(error) }, LOG_CTX);
            this.coreRequested = false;
            const waiting = this.waiting;
            this.waiting = [];
            for (const call of waiting) call.fail(error);
        });
    }

    /// The writer of the core, created once the package instantiated the core
    protected nativeWriter(): core.DashQLStorageWriter | null {
        if (this.native == null) {
            const instance = core.DashQL.instantiated();
            if (instance != null) this.provideCore(instance);
        }
        return this.native;
    }

    /// Call the writer of the core, a call before the core waits for it. A call that writes asks for the core.
    protected call<T>(run: (native: core.DashQLStorageWriter) => Promise<T>, request: boolean): Promise<T> {
        const native = this.nativeWriter();
        if (native != null) return run(native);
        return new Promise<T>((resolve, reject) => {
            this.waiting.push({ run: native => { run(native).then(resolve, reject); }, fail: reject });
            if (request) this.requestCore();
        });
    }

    /// Change the writer of the core, a change before the core waits for it
    protected command(run: (native: core.DashQLStorageWriter) => void): void {
        const native = this.nativeWriter();
        if (native != null) {
            run(native);
            return;
        }
        this.waiting.push({ run, fail: () => { } });
    }

    /// Run a service of the core that writes through the writer of the core, e.g. the restore. It waits for the core
    /// like a write.
    public withNativeWriter<T>(run: (native: core.DashQLStorageWriter) => Promise<T>): Promise<T> {
        return this.call(run, true);
    }

    /// The writer of the core asks the backend, the timers, the clock and the log through this host. A service of the
    /// core that writes through the writer extends it, e.g. the restore.
    public createHost(): core.StorageWriterHost {
        const notify = <T>(subscribers: Set<(value: T) => void>, value: T) => {
            for (const subscriber of subscribers) {
                try {
                    subscriber(value);
                } catch (e) {
                    this.logger.error('A subscriber of the storage writer failed', { error: stringifyError(e) }, LOG_CTX);
                }
            }
        };
        return {
            now: () => Date.now(),
            setTimer: (ms, callback) => setTimeout(callback, ms),
            clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
            log: (level, message, details) => this.logger[level](message, JSON.parse(details), LOG_CTX),
            loadWorkbook: async workbookId => JSON.stringify(await this.backend.loadWorkbook(workbookId)),
            saveWorkbook: async (workbookId, workbook) => this.backend.saveWorkbookManifest(workbookId, JSON.parse(workbook)),
            saveScript: async (workbookId, fileName, text) => this.backend.saveScript(workbookId, fileName, text),
            deleteScript: async (workbookId, fileName) => this.backend.deleteScript(workbookId, fileName),
            renameScript: async (workbookId, from, to) => this.backend.renameScript(workbookId, from, to),
            // The natural order of file names follows the collator of the host
            listAttachments: async workbookId => workbookAttachments((await this.backend.listDataFiles(workbookId)).map(file => file.name)).map(attachment => attachment.name),
            updateConnections: async update => this.requireRegistry().updateConnections(connections => {
                const next = update(connections === undefined ? null : JSON.stringify(connections));
                return next == null ? null : JSON.parse(next) as ConnectionEntry[];
            }),
            saveConnectionFile: async (connectionId, fileName, text) => this.requireRegistry().saveConnectionFile(connectionId, fileName, text),
            deleteConnectionFiles: async connectionId => this.requireRegistry().deleteConnectionFiles(connectionId),
            deleteWorkbook: async workbookId => this.backend.deleteWorkbook(workbookId),
            statisticsChanged: (key, scheduledWrites, writes, writtenBytes, writeTimeMs, lastWriteMs) => {
                this.statistics = this.statistics.set(key, {
                    totalScheduledWrites: scheduledWrites,
                    totalWrites: writes,
                    totalWrittenBytes: writtenBytes,
                    totalWriteTime: writeTimeMs,
                    lastWrite: lastWriteMs == null ? null : new Date(lastWriteMs),
                });
                notify(this.statisticsSubscribers, this.statistics);
            },
            externalScriptChange: workbookId => notify(this.externalChangeSubscribers, workbookId),
        };
    }

    /// The backend as workbook registry, connection writes need one
    protected requireRegistry(): WorkbookRegistryBackend {
        if (!isWorkbookRegistryBackend(this.backend)) {
            throw new Error('the storage backend does not own a workbook registry');
        }
        return this.backend;
    }

    /// Pause the writer. Nothing is written until resume() or flush(), writes scheduled while paused stay pending.
    public pause(): void {
        this.command(native => native.pause());
    }

    /// Resume the writer, the pending tasks wait for their debounce duration again
    public resume(): void {
        this.command(native => native.resume());
    }

    /// Flush the writer: run every pending task right away and wait until all writes finished.
    /// Works regardless of the paused state and leaves the paused state unchanged.
    public flush(): Promise<void> {
        // Without a core nothing was written yet
        if (this.nativeWriter() == null && !this.coreRequested) return Promise.resolve();
        return this.call(native => native.flush(), false);
    }

    public getStatistics(): StorageWriteStatisticsMap {
        return this.statistics;
    }

    public pauseWorkbook(workbookId: string): void {
        this.command(native => native.pauseWorkbook(workbookId));
    }

    public resumeWorkbook(workbookId: string): void {
        this.command(native => native.resumeWorkbook(workbookId));
    }

    /// The pending write keys in the order they were scheduled
    public getPendingKeys(): string[] {
        return this.nativeWriter()?.pendingKeys() ?? [];
    }

    /// Pending write keys below a workbook id. This is intentionally prefix-based: every writer key
    /// is rooted at the workbook id, including the delete/rename action namespaces.
    public getPendingKeysForWorkbook(workbookId: string, include: (key: string) => boolean = () => true): string[] {
        return (this.nativeWriter()?.pendingKeys(workbookId) ?? []).filter(include);
    }

    /// Discard pending writes for a workbook, resolving their promises as not executed. Used only
    /// after the user explicitly chooses an externally-written disk version over local debounced
    /// edits. Writes already in flight cannot be cancelled and are handled by settle().
    public cancelPendingWritesForWorkbook(workbookId: string, include: (key: string) => boolean = () => true): void {
        this.command(native => native.cancelPendingWrites(native.pendingKeys(workbookId).filter(include)));
    }

    /// Discard the pending writes of the files of a connection that is deleted, they would recreate its folder
    public cancelPendingConnectionFileWrites(connectionId: string): void {
        this.command(native => native.cancelPendingConnectionFileWrites(connectionId));
    }

    /// Delete a workbook from the storage.
    /// The pending writes of the workbook are discarded and writes that already started finish first,
    /// no write recreates files of the deleted workbook afterwards.
    public deleteWorkbook(workbookId: string): Promise<void> {
        return this.call(native => native.deleteWorkbook(workbookId), true);
    }

    /// A workbook with the id of a deleted workbook was registered again, e.g. by importing the same bundle.
    /// Writes for the id are accepted again, the writes discarded while it was deleted stay discarded.
    public reviveWorkbook(workbookId: string): void {
        this.command(native => native.reviveWorkbook(workbookId));
    }

    /// Is a workbook held, e.g. after one of its scripts changed outside the app?
    /// Its writes stay pending until the workbook resumes.
    public isWorkbookPaused(workbookId: string): boolean {
        return this.nativeWriter()?.isWorkbookPaused(workbookId) ?? false;
    }

    /// Write the pending tasks of a workbook right away and wait until they are persisted.
    ///
    /// Resolves true when every pending write of the workbook reached the storage. A held writer or
    /// workbook keeps its writes pending and resolves false. Unlike flush(), a held workbook is never
    /// forced, its writes would overwrite the external change. A failed write stays pending as well,
    /// unless a newer write of its key replaced it, and the next flush writes it again.
    public flushWorkbook(workbookId: string): Promise<boolean> {
        return this.call(native => native.flushWorkbook(workbookId), true);
    }

    /// Wait for writes that have already started without flushing pending debounced work.
    public settle(): Promise<void> {
        if (this.nativeWriter() == null && !this.coreRequested) return Promise.resolve();
        return this.call(native => native.settle(), false);
    }

    public getWorkbookWriteGeneration(workbookId: string, include: (key: string) => boolean = () => true): number {
        let generation = 0;
        for (const [key, value] of this.nativeWriter()?.writeGenerations(workbookId) ?? []) {
            if (include(key)) generation = Math.max(generation, value);
        }
        return generation;
    }

    /// Subscribe to script writes that are held because the script changed outside the app
    public subscribeExternalChanges(subscriber: ExternalScriptChangeSubscriber): () => void {
        this.externalChangeSubscribers.add(subscriber);
        return () => this.externalChangeSubscribers.delete(subscriber);
    }

    public subscribeStatisticsListener(listener: StorageWriteStatisticsSubscriber) {
        this.statisticsSubscribers.add(listener);
    }
    public unsubscribeStatisticsListener(listener: StorageWriteStatisticsSubscriber) {
        this.statisticsSubscribers.delete(listener);
    }

    /// Schedule a debounced write, resolves true when the task was executed.
    /// A newer write with the same key replaces a pending task and resolves its caller with false.
    public async write(key: string, task: StorageWriteTaskVariant, debounceFor: number = 0): Promise<boolean> {
        const result = await this.call(native => native.write(key, nativeTask(task), debounceFor), true);
        return result.status === 'written';
    }

    /// Write without debouncing and wait until the content is persisted.
    ///
    /// The task replaces any pending task with the same key and is executed right away, chained after
    /// running tasks of the same chain key. A paused writer or workbook resolves with `deferred` and
    /// keeps the task pending, it is executed on resume.
    public async writeDurable(key: string, task: StorageWriteTaskVariant): Promise<StorageWriteResult> {
        return writeResultOf(await this.call(native => native.writeDurable(key, nativeTask(task)), true));
    }
}
