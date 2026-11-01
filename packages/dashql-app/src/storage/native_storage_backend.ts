import { type StorageBackend, type SessionData, type ScriptData, type SessionEntry, type AppSettings, StorageBackendType, STORAGE_SESSION_FILE, STORAGE_SCRIPTS_FOLDER } from './storage_backend.js';
import { type DataFile, type DataFileContent, ExternalScriptChangeError, STORAGE_ATTACHMENTS_FOLDER, isAttachmentFileName, validateDataFileName } from './storage_backend.js';

import { exists, fileStamp, join, listFiles, mkdir, readDir, readFile, readTextFile, remove, rename, writeFile, writeTextFile, type FileStamp } from '../platform/electron_fs.js';

/// The name of the session-level .gitignore that keeps generated files out of version control.
const GITIGNORE_FILE = '.gitignore';
/// The entries of the session-level .gitignore: the former query result cache of the session and Hyper database files.
const GITIGNORE_ENTRIES = ['cache/', '*.hyper'];

/// A file of a session folder with its stamp
export type NamedFileStamp = FileStamp & { name: string };

/// The scripts and attachments of a session folder with their stamps
export interface SessionFolderStamps {
    scripts: NamedFileStamp[];
    attachments: NamedFileStamp[];
}

function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
    return a == null || b == null ? a == b : a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/// Native filesystem storage backend for a single Electron session.
///
/// One directory holds exactly one session. Unlike OPFS, there is no `sessions/<uuid>` nesting and
/// no manifest file in the directory: the session's files (`dashql-session.json`,
/// `dashql-catalog-relations.sql`, `dashql-catalog-functions.sql`, `scripts/…`) are written *directly* under the
/// configured directory. The session UUID passed to each method identifies the session for the
/// caller's routing, but does not affect the on-disk layout (the directory already is the session).
///
/// The session *registry* (which sessions exist, and where each lives) is owned by the OPFS root
/// manifest, not here. The registry-level methods on this backend are therefore inert; the
/// composite backend always routes those to OPFS.
export class NativeStorageBackend implements StorageBackend {
    /// The absolute directory on disk that holds this session's files
    private readonly dir: string;
    /// Whether the .gitignore was already checked by this backend
    private gitignoreChecked = false;
    /// The stamps of the scripts as this backend last wrote or acknowledged them, null for a deleted script
    private readonly scriptStamps = new Map<string, FileStamp | null>();
    /// Were the scripts acknowledged? From then on a script without a stamp is known to be absent, and
    /// script writes fail with an `ExternalScriptChangeError` when the stamp on disk differs.
    private scriptsAcknowledged = false;

    constructor(dir: string) {
        this.dir = dir;
    }

    getBackendType(): StorageBackendType {
        return StorageBackendType.Native;
    }

    /// The absolute directory backing this session
    getDir(): string {
        return this.dir;
    }

    async initialize(): Promise<void> {
        if (!(await exists(this.dir))) {
            await mkdir(this.dir, { recursive: true });
        }
    }

    /// Resolve a relative storage path against the absolute directory using OS-correct separators
    private async abs(relative: string): Promise<string> {
        const parts = relative.split('/').filter(p => p.length > 0);
        return await join(this.dir, ...parts);
    }

    /// Ensure a directory (given as a relative path) exists
    private async ensureDir(relative: string): Promise<void> {
        const dir = relative.length > 0 ? await this.abs(relative) : this.dir;
        if (!(await exists(dir))) {
            await mkdir(dir, { recursive: true });
        }
    }

    /// Natural sort for strings with numeric components (e.g., "page-1" < "page-2" < "page-10")
    private naturalSort(a: string, b: string): number {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    // ---- Registry-level operations (owned by OPFS; inert here) -------------------------------

    async listSessions(_manifestPath: string): Promise<SessionEntry[]> {
        // The registry lives in the OPFS root manifest, never in a native session directory.
        return [];
    }

    async loadAppSettings(): Promise<AppSettings | null> {
        return null;
    }

    async saveAppSettings(_settings: AppSettings): Promise<void> {
        // No-op: app settings live on the OPFS root manifest.
    }

    // ---- Per-session operations ---------------------------------------------------------------

    /// Read a file of the session folder, null if it does not exist
    private async readSessionFile(fileName: string): Promise<string | null> {
        const path = await this.abs(fileName);
        return await exists(path) ? await readTextFile(path) : null;
    }

    async loadSession(sessionId: string): Promise<SessionData> {
        const text = await this.readSessionFile(STORAGE_SESSION_FILE);
        if (text == null) {
            throw new Error(`Missing ${STORAGE_SESSION_FILE} in ${this.dir}`);
        }
        return JSON.parse(text) as SessionData;
    }

    /// Ensure the session-level .gitignore holds our entries. Missing entries are appended, so a
    /// user-authored .gitignore keeps its own lines and folders from older versions get new entries.
    private async ensureGitignore(): Promise<void> {
        if (this.gitignoreChecked) return;
        const file = await this.abs(GITIGNORE_FILE);
        const existing = (await exists(file)) ? await readTextFile(file) : '';
        const lines = new Set(existing.split(/\r?\n/).map(line => line.trim()));
        const missing = GITIGNORE_ENTRIES.filter(entry => !lines.has(entry));
        if (missing.length > 0) {
            const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
            await writeTextFile(file, `${existing}${separator}${missing.join('\n')}\n`);
        }
        this.gitignoreChecked = true;
    }

    async saveSessionManifest(_sessionId: string, data: SessionData): Promise<void> {
        await this.ensureDir('');
        // Keep generated files out of version control as soon as the session folder is written
        await this.ensureGitignore();
        const metaFile = await this.abs(STORAGE_SESSION_FILE);
        await writeTextFile(metaFile, JSON.stringify(data, null, 2));
    }



    async deleteSession(_sessionId: string): Promise<void> {
        // No-op: a native session lives in a user-owned folder on disk. Deleting the session in
        // dashql only unregisters it — the registry entry lives in the OPFS root manifest and is
        // dropped by the composite backend. The files on disk are deliberately left intact so the
        // folder can be re-loaded later (and so we never destroy data the user put there).
    }

    async loadScripts(_sessionId: string): Promise<ScriptData[]> {
        const scriptsDir = await this.abs(STORAGE_SCRIPTS_FOLDER);
        if (!(await exists(scriptsDir))) {
            return [];
        }

        const entries = await readDir(scriptsDir);
        const scripts: ScriptData[] = [];
        for (const entry of entries) {
            if (entry.isDirectory) {
                throw new Error(`Invalid V2 session layout: nested scripts directory ${entry.name}`);
            }
            if (entry.isFile && entry.name.toLowerCase() === 'dashql-draft.sql') {
                throw new Error('Invalid V2 session layout: dashql-draft.sql is not supported');
            }
            if (entry.isFile && entry.name.toLowerCase().endsWith('.sql')) {
                const sql = await readTextFile(await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${entry.name}`));
                scripts.push({ name: entry.name, sql });
            }
        }
        scripts.sort((a, b) => this.naturalSort(a.name, b.name));
        return scripts;
    }

    async loadScript(sessionId: string, scriptName: string): Promise<ScriptData> {
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${scriptName}`);
        if (!(await exists(scriptFile))) {
            throw new Error(`Script not found: session ${sessionId}, script ${scriptName}`);
        }
        const sql = await readTextFile(scriptFile);
        return { name: scriptName, sql };
    }

    async saveScript(
        sessionId: string,
        scriptName: string,
        sql: string
    ): Promise<void> {
        await this.ensureDir(STORAGE_SCRIPTS_FOLDER);
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${scriptName}`);
        await this.checkScriptUnchanged(sessionId, scriptName, scriptFile);
        this.scriptStamps.set(scriptName, await writeTextFile(scriptFile, sql));
    }

    async deleteScript(sessionId: string, scriptName: string): Promise<void> {
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${scriptName}`);
        await this.checkScriptUnchanged(sessionId, scriptName, scriptFile);
        if (await exists(scriptFile)) {
            await remove(scriptFile);
        }
        this.scriptStamps.set(scriptName, null);
    }

    async renameScript(sessionId: string, oldScriptName: string, newScriptName: string): Promise<void> {
        if (oldScriptName === newScriptName) {
            return;
        }
        const oldFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${oldScriptName}`);
        const newFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${newScriptName}`);
        // The rename must neither move an external version nor replace an external file
        await this.checkScriptUnchanged(sessionId, oldScriptName, oldFile);
        await this.checkScriptUnchanged(sessionId, newScriptName, newFile);
        // A missing source means the script hasn't been flushed yet; the pending write under the new
        // name will create it, so there is nothing to move here.
        if (!(await exists(oldFile))) {
            return;
        }
        // Atomic file rename. The new clean base is disambiguated unique within the folder, so the
        // destination is free. The file keeps its stamp.
        await rename(oldFile, newFile);
        this.scriptStamps.set(newScriptName, this.scriptStamps.get(oldScriptName) ?? null);
        this.scriptStamps.set(oldScriptName, null);
    }

    /// The stamps of the scripts and attachments, read from two directory listings without reading a file
    async stampFolder(): Promise<SessionFolderStamps> {
        const [scripts, attachments] = await Promise.all([
            listFiles(await this.abs(STORAGE_SCRIPTS_FOLDER)),
            listFiles(await this.abs(STORAGE_ATTACHMENTS_FOLDER)),
        ]);
        return { scripts: scripts.filter(file => file.name.toLowerCase().endsWith('.sql')), attachments: attachments.filter(file => isAttachmentFileName(file.name)) };
    }

    /// Acknowledge the scripts as they are on disk, script writes check the disk from now on
    acknowledgeScripts(scripts: NamedFileStamp[]): void {
        this.scriptStamps.clear();
        for (const script of scripts) {
            this.scriptStamps.set(script.name, { size: script.size, mtimeMs: script.mtimeMs });
        }
        this.scriptsAcknowledged = true;
    }

    /// The scripts whose stamps differ from what this backend wrote or acknowledged, sorted by name.
    /// Every script differs before the scripts were acknowledged.
    findExternalScriptChanges(scripts: NamedFileStamp[]): string[] {
        const disk = new Map(scripts.map(script => [script.name, script]));
        const names = new Set(disk.keys());
        for (const [name, stamp] of this.scriptStamps) {
            if (stamp != null) names.add(name);
        }
        if (!this.scriptsAcknowledged) {
            return [...names].sort();
        }
        return [...names].filter(name => !sameStamp(disk.get(name) ?? null, this.scriptStamps.get(name) ?? null)).sort();
    }

    /// Fail with an `ExternalScriptChangeError` when an acknowledged script changed on disk
    private async checkScriptUnchanged(sessionId: string, scriptName: string, scriptFile: string): Promise<void> {
        if (this.scriptsAcknowledged && !sameStamp(await fileStamp(scriptFile), this.scriptStamps.get(scriptName) ?? null)) {
            throw new ExternalScriptChangeError(sessionId, scriptName);
        }
    }

    async listDataFiles(_sessionId: string): Promise<DataFile[]> {
        const dir = await this.abs(STORAGE_ATTACHMENTS_FOLDER);
        if (!(await exists(dir))) return [];
        const files: DataFile[] = [];
        for (const entry of await readDir(dir)) {
            if (entry.isDirectory) throw new Error(`Invalid session layout: nested data directory ${entry.name}`);
            // Other files in the folder are no attachments
            if (entry.isFile && isAttachmentFileName(entry.name)) {
                validateDataFileName(entry.name);
                const stamp = await fileStamp(await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${entry.name}`));
                if (stamp != null) files.push({ name: entry.name, sizeBytes: stamp.size, mtimeMs: stamp.mtimeMs });
            }
        }
        return files.sort((a, b) => this.naturalSort(a.name, b.name));
    }

    async loadDataFile(_sessionId: string, name: string): Promise<Uint8Array> {
        validateDataFileName(name);
        return await readFile(await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${name}`));
    }

    async saveDataFile(sessionId: string, name: string, content: DataFileContent): Promise<void> {
        validateDataFileName(name);
        await this.ensureDir(STORAGE_ATTACHMENTS_FOLDER);
        const bytes = content instanceof Blob ? new Uint8Array(await content.arrayBuffer()) : content;
        await writeFile(await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${name}`), bytes);
    }

    async deleteDataFile(sessionId: string, name: string): Promise<void> {
        validateDataFileName(name);
        const path = await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${name}`);
        if (!(await exists(path))) return;
        await remove(path);
    }

    async renameDataFile(sessionId: string, oldName: string, newName: string): Promise<void> {
        validateDataFileName(oldName);
        validateDataFileName(newName);
        if (oldName === newName) return;
        const oldPath = await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${oldName}`);
        if (!(await exists(oldPath))) return;
        await rename(oldPath, await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${newName}`));
    }

    async clearAllStorage(): Promise<void> {
        // No-op: like deleteSession, this never touches the user-owned folder on disk. "Clear all
        // storage" only resets the OPFS root (registry + OPFS-backed sessions); native sessions are
        // simply unregistered when the manifest is wiped, and their files stay put on disk.
    }
}
