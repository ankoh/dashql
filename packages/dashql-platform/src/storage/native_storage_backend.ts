import { type StorageBackend, type WorkbookData, type ScriptData, type WorkbookEntry, type AppSettings, StorageBackendType, STORAGE_WORKBOOK_FILE, STORAGE_SCRIPTS_FOLDER } from './storage_backend.js';
import { type DataFile, type DataFileContent, ExternalScriptChangeError, STORAGE_ATTACHMENTS_FOLDER, isAttachmentFileName, validateDataFileName } from './storage_backend.js';

import { joinPath, type FileStamp, type FileSystem } from '../platform/file_system.js';

/// The name of the workbook-level .gitignore that keeps generated files out of version control.
const GITIGNORE_FILE = '.gitignore';
/// The entries of the workbook-level .gitignore: the former query result cache of the workbook and Hyper database files.
const GITIGNORE_ENTRIES = ['cache/', '*.hyper'];

/// A file of a workbook folder with its stamp
export type NamedFileStamp = FileStamp & { name: string };

/// The scripts and attachments of a workbook folder with their stamps
export interface WorkbookFolderStamps {
    scripts: NamedFileStamp[];
    attachments: NamedFileStamp[];
}

function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
    return a == null || b == null ? a == b : a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/// A storage backend for a single workbook in a folder of a file system, the one of the desktop app or of Node.
///
/// One directory holds exactly one workbook. Unlike OPFS, there is no `workbooks/<uuid>` nesting and
/// no manifest file in the directory: the workbook's files (`dashql-workbook.json`,
/// `dashql-catalog-relations.sql`, `dashql-catalog-functions.sql`, `scripts/…`) are written *directly* under the
/// configured directory. The workbook UUID passed to each method identifies the workbook for the
/// caller's routing, but does not affect the on-disk layout (the directory already is the workbook).
///
/// The workbook *registry* (which workbooks exist, and where each lives) is owned by the OPFS root
/// manifest, not here. The registry-level methods on this backend are therefore inert; the
/// composite backend always routes those to OPFS.
export class NativeStorageBackend implements StorageBackend {
    /// The absolute directory on disk that holds this workbook's files
    private readonly dir: string;
    /// Whether the .gitignore was already checked by this backend
    private gitignoreChecked = false;
    /// The stamps of the scripts as this backend last wrote or acknowledged them, null for a deleted script
    private readonly scriptStamps = new Map<string, FileStamp | null>();
    /// Were the scripts acknowledged? From then on a script without a stamp is known to be absent, and
    /// script writes fail with an `ExternalScriptChangeError` when the stamp on disk differs.
    private scriptsAcknowledged = false;

    constructor(dir: string, protected readonly fs: FileSystem) {
        this.dir = dir;
    }

    getBackendType(): StorageBackendType {
        return StorageBackendType.Native;
    }

    /// The absolute directory backing this workbook
    getDir(): string {
        return this.dir;
    }

    async initialize(): Promise<void> {
        if (!(await this.fs.exists(this.dir))) {
            await this.fs.mkdir(this.dir, { recursive: true });
        }
    }

    /// Resolve a relative storage path against the absolute directory using OS-correct separators
    private async abs(relative: string): Promise<string> {
        const parts = relative.split('/').filter(p => p.length > 0);
        return await joinPath(this.dir, ...parts);
    }

    /// Ensure a directory (given as a relative path) exists
    private async ensureDir(relative: string): Promise<void> {
        const dir = relative.length > 0 ? await this.abs(relative) : this.dir;
        if (!(await this.fs.exists(dir))) {
            await this.fs.mkdir(dir, { recursive: true });
        }
    }

    /// Natural sort for strings with numeric components (e.g., "page-1" < "page-2" < "page-10")
    private naturalSort(a: string, b: string): number {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    // ---- Registry-level operations (owned by OPFS; inert here) -------------------------------

    async listWorkbooks(): Promise<WorkbookEntry[]> {
        // The registry lives in the OPFS workbook tree, never in a native workbook directory.
        return [];
    }

    async loadAppSettings(): Promise<AppSettings | null> {
        return null;
    }

    async saveAppSettings(_settings: AppSettings): Promise<void> {
        // No-op: app settings live on the OPFS root manifest.
    }

    // ---- Per-workbook operations ---------------------------------------------------------------

    /// Read a file of the workbook folder, null if it does not exist
    private async readWorkbookFile(fileName: string): Promise<string | null> {
        const path = await this.abs(fileName);
        return await this.fs.exists(path) ? await this.fs.readTextFile(path) : null;
    }

    // ---- The folder as the runtime migrates it (`RuntimeWorkbookFolder` of the core) --------------

    /// A file of the folder by its path below the folder, null if it does not exist
    async readText(path: string): Promise<string | null> {
        return await this.readWorkbookFile(path);
    }

    /// Write a top-level file of the folder
    async writeText(name: string, text: string): Promise<void> {
        await this.ensureDir('');
        await this.fs.writeTextFile(await this.abs(name), text);
    }

    /// Remove a top-level file of the folder, a missing file is ignored
    async remove(name: string): Promise<void> {
        const path = await this.abs(name);
        if (await this.fs.exists(path)) {
            await this.fs.remove(path);
        }
    }

    /// The runtime migrates a folder of an older version of the app before it reads the workbook file
    async loadWorkbook(workbookId: string): Promise<WorkbookData> {
        const text = await this.readWorkbookFile(STORAGE_WORKBOOK_FILE);
        if (text == null) {
            throw new Error(`Missing ${STORAGE_WORKBOOK_FILE} in ${this.dir}`);
        }
        return JSON.parse(text) as WorkbookData;
    }

    /// Ensure the workbook-level .gitignore holds our entries. Missing entries are appended, so a
    /// user-authored .gitignore keeps its own lines and folders from older versions get new entries.
    private async ensureGitignore(): Promise<void> {
        if (this.gitignoreChecked) return;
        const file = await this.abs(GITIGNORE_FILE);
        const existing = (await this.fs.exists(file)) ? await this.fs.readTextFile(file) : '';
        const lines = new Set(existing.split(/\r?\n/).map(line => line.trim()));
        const missing = GITIGNORE_ENTRIES.filter(entry => !lines.has(entry));
        if (missing.length > 0) {
            const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
            await this.fs.writeTextFile(file, `${existing}${separator}${missing.join('\n')}\n`);
        }
        this.gitignoreChecked = true;
    }

    async saveWorkbookManifest(_workbookId: string, data: WorkbookData): Promise<void> {
        await this.ensureDir('');
        // Keep generated files out of version control as soon as the workbook folder is written
        await this.ensureGitignore();
        const metaFile = await this.abs(STORAGE_WORKBOOK_FILE);
        await this.fs.writeTextFile(metaFile, JSON.stringify(data, null, 2));
    }



    async deleteWorkbook(_workbookId: string): Promise<void> {
        // No-op: a native workbook lives in a user-owned folder on disk. Deleting the workbook in
        // dashql only unregisters it — the registry entry lives in the OPFS root manifest and is
        // dropped by the composite backend. The files on disk are deliberately left intact so the
        // folder can be re-loaded later (and so we never destroy data the user put there).
    }

    async loadScripts(_workbookId: string): Promise<ScriptData[]> {
        const scriptsDir = await this.abs(STORAGE_SCRIPTS_FOLDER);
        if (!(await this.fs.exists(scriptsDir))) {
            return [];
        }

        const entries = await this.fs.readDir(scriptsDir);
        const scripts: ScriptData[] = [];
        for (const entry of entries) {
            if (entry.isDirectory) {
                throw new Error(`Invalid V2 workbook layout: nested scripts directory ${entry.name}`);
            }
            if (entry.isFile && entry.name.toLowerCase() === 'dashql-draft.sql') {
                throw new Error('Invalid V2 workbook layout: dashql-draft.sql is not supported');
            }
            if (entry.isFile && entry.name.toLowerCase().endsWith('.sql')) {
                const sql = await this.fs.readTextFile(await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${entry.name}`));
                scripts.push({ name: entry.name, sql });
            }
        }
        scripts.sort((a, b) => this.naturalSort(a.name, b.name));
        return scripts;
    }

    async loadScript(workbookId: string, scriptName: string): Promise<ScriptData> {
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${scriptName}`);
        if (!(await this.fs.exists(scriptFile))) {
            throw new Error(`Script not found: workbook ${workbookId}, script ${scriptName}`);
        }
        const sql = await this.fs.readTextFile(scriptFile);
        return { name: scriptName, sql };
    }

    async saveScript(
        workbookId: string,
        scriptName: string,
        sql: string
    ): Promise<void> {
        await this.ensureDir(STORAGE_SCRIPTS_FOLDER);
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${scriptName}`);
        await this.checkScriptUnchanged(workbookId, scriptName, scriptFile);
        this.scriptStamps.set(scriptName, await this.fs.writeTextFile(scriptFile, sql));
    }

    async deleteScript(workbookId: string, scriptName: string): Promise<void> {
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${scriptName}`);
        await this.checkScriptUnchanged(workbookId, scriptName, scriptFile);
        if (await this.fs.exists(scriptFile)) {
            await this.fs.remove(scriptFile);
        }
        this.scriptStamps.set(scriptName, null);
    }

    async renameScript(workbookId: string, oldScriptName: string, newScriptName: string): Promise<void> {
        if (oldScriptName === newScriptName) {
            return;
        }
        const oldFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${oldScriptName}`);
        const newFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${newScriptName}`);
        // The rename must neither move an external version nor replace an external file
        await this.checkScriptUnchanged(workbookId, oldScriptName, oldFile);
        await this.checkScriptUnchanged(workbookId, newScriptName, newFile);
        // A missing source means the script hasn't been flushed yet; the pending write under the new
        // name will create it, so there is nothing to move here.
        if (!(await this.fs.exists(oldFile))) {
            return;
        }
        // Atomic file rename. The new clean base is disambiguated unique within the folder, so the
        // destination is free. The file keeps its stamp.
        await this.fs.rename(oldFile, newFile);
        this.scriptStamps.set(newScriptName, this.scriptStamps.get(oldScriptName) ?? null);
        this.scriptStamps.set(oldScriptName, null);
    }

    /// The stamps of the scripts and attachments, read from two directory listings without reading a file
    async stampFolder(): Promise<WorkbookFolderStamps> {
        const [scripts, attachments] = await Promise.all([
            this.fs.listFiles(await this.abs(STORAGE_SCRIPTS_FOLDER)),
            this.fs.listFiles(await this.abs(STORAGE_ATTACHMENTS_FOLDER)),
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
    private async checkScriptUnchanged(workbookId: string, scriptName: string, scriptFile: string): Promise<void> {
        if (this.scriptsAcknowledged && !sameStamp(await this.fs.fileStamp(scriptFile), this.scriptStamps.get(scriptName) ?? null)) {
            throw new ExternalScriptChangeError(workbookId, scriptName);
        }
    }

    async listDataFiles(_workbookId: string): Promise<DataFile[]> {
        const dir = await this.abs(STORAGE_ATTACHMENTS_FOLDER);
        if (!(await this.fs.exists(dir))) return [];
        const files: DataFile[] = [];
        for (const entry of await this.fs.readDir(dir)) {
            if (entry.isDirectory) throw new Error(`Invalid workbook layout: nested data directory ${entry.name}`);
            // Other files in the folder are no attachments
            if (entry.isFile && isAttachmentFileName(entry.name)) {
                validateDataFileName(entry.name);
                const stamp = await this.fs.fileStamp(await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${entry.name}`));
                if (stamp != null) files.push({ name: entry.name, sizeBytes: stamp.size, mtimeMs: stamp.mtimeMs });
            }
        }
        return files.sort((a, b) => this.naturalSort(a.name, b.name));
    }

    async loadDataFile(_workbookId: string, name: string): Promise<Uint8Array> {
        validateDataFileName(name);
        return await this.fs.readFile(await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${name}`));
    }

    async saveDataFile(workbookId: string, name: string, content: DataFileContent): Promise<void> {
        validateDataFileName(name);
        await this.ensureDir(STORAGE_ATTACHMENTS_FOLDER);
        const bytes = content instanceof Blob ? new Uint8Array(await content.arrayBuffer()) : content;
        await this.fs.writeFile(await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${name}`), bytes);
    }

    async deleteDataFile(workbookId: string, name: string): Promise<void> {
        validateDataFileName(name);
        const path = await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${name}`);
        if (!(await this.fs.exists(path))) return;
        await this.fs.remove(path);
    }

    async renameDataFile(workbookId: string, oldName: string, newName: string): Promise<void> {
        validateDataFileName(oldName);
        validateDataFileName(newName);
        if (oldName === newName) return;
        const oldPath = await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${oldName}`);
        if (!(await this.fs.exists(oldPath))) return;
        await this.fs.rename(oldPath, await this.abs(`${STORAGE_ATTACHMENTS_FOLDER}/${newName}`));
    }

    async clearAllStorage(): Promise<void> {
        // No-op: like deleteWorkbook, this never touches the user-owned folder on disk. "Clear all
        // storage" only resets the OPFS root (registry + OPFS-backed workbooks); native workbooks are
        // simply unregistered when the manifest is wiped, and their files stay put on disk.
    }
}
