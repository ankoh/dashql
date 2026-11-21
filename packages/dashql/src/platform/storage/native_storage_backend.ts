import { type StorageBackend, type WorkbookData, type ScriptData, type WorkbookEntry, type AppSettings, StorageBackendType, STORAGE_WORKBOOK_FILE, STORAGE_SCRIPTS_FOLDER, STORAGE_GITIGNORE_FILE } from './storage_backend.js';
import { type DataFile, type DataFileContent, type ExpectedStamp, ExternalScriptChangeError, STORAGE_ATTACHMENTS_FOLDER, WorkbookFolderMissingError, isAttachmentFileName, matchesExpectedStamp, validateDataFileName } from './storage_backend.js';

import { joinPath, type FileStamp, type FileSystem } from '../file_system.js';

/// The draft script of an older layout, no script of the workbook
const DRAFT_SCRIPT_FILE = 'dashql-draft.sql';

/// A file of a workbook folder with its stamp
export type NamedFileStamp = FileStamp & { name: string };

/// The scripts, the attachments and the workbook file of a workbook folder with their stamps
export interface WorkbookFolderStamps {
    scripts: NamedFileStamp[];
    attachments: NamedFileStamp[];
    /// The workbook file, null if there is none
    workbook: FileStamp | null;
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
///
/// The folder may change outside the app. The runtime keeps the stamps of what it wrote and acknowledged and passes the
/// stamp that a write expects: the backend takes the stamp of the file and refuses the write with an
/// `ExternalScriptChangeError` when it differs, and returns the stamp of what it wrote.
export class NativeStorageBackend implements StorageBackend {
    /// The absolute directory on disk that holds this workbook's files
    private readonly dir: string;

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

    /// Resolve a relative storage path against the absolute directory using OS-correct separators. A path that could
    /// leave the folder is refused: an absolute path, an empty part, `.` or `..`, a backslash, NUL or a drive letter.
    /// The runtime checks the names of imported files before, this is the second line.
    private async abs(relative: string): Promise<string> {
        const parts = relative.split('/');
        if (parts.some(part => part.length === 0 || part === '.' || part === '..' || /[\\\0]/.test(part) || /^[A-Za-z]:/.test(part))) {
            throw new Error(`Invalid path in the workbook folder ${this.dir}: ${relative}`);
        }
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

    /// Write a top-level file of the folder, returns its stamp: the runtime records the writes of a migration as its own
    async writeText(name: string, text: string): Promise<FileStamp> {
        await this.ensureDir('');
        return await this.fs.writeTextFile(await this.abs(name), text);
    }

    /// Remove a top-level file of the folder, a missing file is ignored
    async remove(name: string): Promise<void> {
        const path = await this.abs(name);
        if (await this.fs.exists(path)) {
            await this.fs.remove(path);
        }
    }

    /// The runtime migrates a folder of an older version of the app before it reads the workbook file
    async loadWorkbook(_workbookId: string): Promise<WorkbookData> {
        const text = await this.readWorkbookFile(STORAGE_WORKBOOK_FILE);
        if (text == null) {
            throw new Error(`Missing ${STORAGE_WORKBOOK_FILE} in ${this.dir}`);
        }
        return JSON.parse(text) as WorkbookData;
    }

    async loadGitignore(_workbookId: string): Promise<string | null> {
        const file = await this.abs(STORAGE_GITIGNORE_FILE);
        return await this.fs.exists(file) ? await this.fs.readTextFile(file) : null;
    }

    async saveGitignore(_workbookId: string, text: string): Promise<void> {
        await this.fs.writeTextFile(await this.abs(STORAGE_GITIGNORE_FILE), text);
    }

    /// Write the workbook file atomically if it is what the write expects, returns its stamp
    async saveWorkbookManifest(workbookId: string, data: WorkbookData, expected?: ExpectedStamp): Promise<FileStamp> {
        await this.ensureDir('');
        const metaFile = await this.abs(STORAGE_WORKBOOK_FILE);
        await this.checkStamp(workbookId, STORAGE_WORKBOOK_FILE, metaFile, expected);
        return await this.fs.writeTextFile(metaFile, JSON.stringify(data, null, 2));
    }

    async deleteWorkbook(_workbookId: string): Promise<void> {
        // No-op: a native workbook lives in a user-owned folder on disk. Deleting the workbook in
        // dashql only unregisters it — the registry entry lives in the OPFS root manifest and is
        // dropped by the composite backend. The files on disk are deliberately left intact so the
        // folder can be re-loaded later (and so we never destroy data the user put there).
    }

    /// The script files of the folder in natural order. A folder in `scripts/`, the draft script of an older layout and
    /// other files are no scripts of the workbook, they are left alone.
    async loadScripts(_workbookId: string): Promise<ScriptData[]> {
        const scriptsDir = await this.abs(STORAGE_SCRIPTS_FOLDER);
        if (!(await this.fs.exists(scriptsDir))) {
            return [];
        }
        const entries = await this.fs.readDir(scriptsDir);
        const scripts: ScriptData[] = [];
        for (const entry of entries) {
            const name = entry.name.toLowerCase();
            if (!entry.isFile || name === DRAFT_SCRIPT_FILE || !name.endsWith('.sql')) {
                continue;
            }
            const sql = await this.fs.readTextFile(await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${entry.name}`));
            scripts.push({ name: entry.name, sql });
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

    async saveScript(workbookId: string, scriptName: string, sql: string, expected?: ExpectedStamp): Promise<FileStamp> {
        await this.ensureScriptsDir();
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${scriptName}`);
        await this.checkStamp(workbookId, scriptName, scriptFile, expected);
        return await this.fs.writeTextFile(scriptFile, sql);
    }

    async deleteScript(workbookId: string, scriptName: string, expected?: ExpectedStamp): Promise<void> {
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${scriptName}`);
        await this.checkStamp(workbookId, scriptName, scriptFile, expected);
        if (await this.fs.exists(scriptFile)) {
            await this.fs.remove(scriptFile);
        }
    }

    async renameScript(workbookId: string, oldScriptName: string, newScriptName: string, expectedFrom?: ExpectedStamp, expectedTo?: ExpectedStamp): Promise<void> {
        if (oldScriptName === newScriptName) {
            return;
        }
        const oldFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${oldScriptName}`);
        const newFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${newScriptName}`);
        // The rename must neither move an external version nor replace an external file
        await this.checkStamp(workbookId, oldScriptName, oldFile, expectedFrom);
        await this.checkStamp(workbookId, newScriptName, newFile, expectedTo);
        // A missing source means the script hasn't been flushed yet; the pending write under the new
        // name will create it, so there is nothing to move here.
        if (!(await this.fs.exists(oldFile))) {
            return;
        }
        // Atomic file rename, the file keeps its stamp
        await this.fs.rename(oldFile, newFile);
    }

    /// The scripts folder of the workbook, created when missing. A missing workbook folder is not created again, e.g.
    /// a native folder that was moved or deleted: the write fails instead.
    private async ensureScriptsDir(): Promise<void> {
        if (!(await this.fs.exists(this.dir))) {
            throw new WorkbookFolderMissingError(this.dir);
        }
        await this.ensureDir(STORAGE_SCRIPTS_FOLDER);
    }

    /// The stamps of the scripts, the attachments and the workbook file, read from two directory listings and one
    /// stamp without reading a file
    async stampFolder(): Promise<WorkbookFolderStamps> {
        const [scripts, attachments, workbook] = await Promise.all([
            this.fs.listFiles(await this.abs(STORAGE_SCRIPTS_FOLDER)),
            this.fs.listFiles(await this.abs(STORAGE_ATTACHMENTS_FOLDER)),
            this.fs.fileStamp(await this.abs(STORAGE_WORKBOOK_FILE)),
        ]);
        return {
            scripts: scripts.filter(file => file.name.toLowerCase().endsWith('.sql')),
            attachments: attachments.filter(file => isAttachmentFileName(file.name)),
            workbook,
        };
    }

    /// Fail with an `ExternalScriptChangeError` when a file is not what a write expects. Only a missing file counts as
    /// absent, any other error of the stamp fails the write.
    private async checkStamp(workbookId: string, fileName: string, path: string, expected: ExpectedStamp): Promise<void> {
        if (expected !== undefined && !matchesExpectedStamp(await this.fs.fileStamp(path), expected)) {
            throw new ExternalScriptChangeError(workbookId, fileName);
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
