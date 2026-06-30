import { type StorageBackend, type SessionData, type PageData, type ScriptData, type SessionEntry, type AppSettings, StorageBackendType, STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT, STORAGE_SCRIPT_SCHEMA, STORAGE_SCRIPT_FUNCTIONS } from './storage_backend.js';

import { exists, mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

/// Native filesystem storage backend for a single session (Tauri only).
///
/// One directory holds exactly one session. Unlike OPFS, there is no `sessions/<uuid>` nesting and
/// no manifest file in the directory: the session's files (`dashql-session.json`,
/// `dashql-relations.sql`, `dashql-functions.sql`, `notebook/…`) are written *directly* under the
/// configured directory. The session UUID passed to each method identifies the session for the
/// caller's routing, but does not affect the on-disk layout (the directory already is the session).
///
/// The session *registry* (which sessions exist, and where each lives) is owned by the OPFS root
/// manifest, not here. The registry-level methods on this backend are therefore inert; the
/// composite backend always routes those to OPFS.
export class NativeStorageBackend implements StorageBackend {
    /// The absolute directory on disk that holds this session's files
    private readonly dir: string;

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

    async loadSession(sessionId: string): Promise<SessionData> {
        const metaFile = await this.abs(STORAGE_SESSION_FILE);
        const text = await readTextFile(metaFile);
        const data: SessionData = JSON.parse(text);

        // sessionId is required - will throw if missing
        if (!data.sessionId) {
            throw new Error(`Session ${sessionId} is missing required sessionId field. Please migrate the session or regenerate it.`);
        }

        return data;
    }

    async saveSessionManifest(_sessionId: string, data: SessionData): Promise<void> {
        await this.ensureDir('');
        const metaFile = await this.abs(STORAGE_SESSION_FILE);
        await writeTextFile(metaFile, JSON.stringify(data, null, 2));
    }

    async deleteSession(_sessionId: string): Promise<void> {
        // No-op: a native session lives in a user-owned folder on disk. Deleting the session in
        // dashql only unregisters it — the registry entry lives in the OPFS root manifest and is
        // dropped by the composite backend. The files on disk are deliberately left intact so the
        // folder can be re-loaded later (and so we never destroy data the user put there).
    }

    async loadSessionSchema(_sessionId: string): Promise<string | null> {
        const schemaFile = await this.abs(STORAGE_SCRIPT_SCHEMA);
        if (!(await exists(schemaFile))) {
            return null;
        }
        return await readTextFile(schemaFile);
    }

    async saveSessionSchema(_sessionId: string, sql: string): Promise<void> {
        await this.ensureDir('');
        const schemaFile = await this.abs(STORAGE_SCRIPT_SCHEMA);
        await writeTextFile(schemaFile, sql);
    }

    async loadSessionFunctions(_sessionId: string): Promise<string | null> {
        const functionsFile = await this.abs(STORAGE_SCRIPT_FUNCTIONS);
        if (!(await exists(functionsFile))) {
            return null;
        }
        return await readTextFile(functionsFile);
    }

    async saveSessionFunctions(_sessionId: string, sql: string): Promise<void> {
        await this.ensureDir('');
        const functionsFile = await this.abs(STORAGE_SCRIPT_FUNCTIONS);
        await writeTextFile(functionsFile, sql);
    }

    async loadNotebookPages(_sessionId: string): Promise<PageData[]> {
        const notebookDir = await this.abs(STORAGE_NOTEBOOK_FOLDER);
        if (!(await exists(notebookDir))) {
            return [];
        }

        const entries = await readDir(notebookDir);
        const pages: PageData[] = [];
        for (const entry of entries) {
            if (entry.isDirectory) {
                const scripts = await this.loadScriptsInPage(`${STORAGE_NOTEBOOK_FOLDER}/${entry.name}`);
                pages.push({ name: entry.name, scripts });
            }
        }
        pages.sort((a, b) => this.naturalSort(a.name, b.name));
        return pages;
    }

    private async loadScriptsInPage(pageRel: string): Promise<ScriptData[]> {
        const pageDir = await this.abs(pageRel);
        const scripts: ScriptData[] = [];
        if (!(await exists(pageDir))) {
            return scripts;
        }

        const entries = await readDir(pageDir);
        for (const entry of entries) {
            if (entry.isFile && entry.name.endsWith('.sql') && entry.name !== STORAGE_SCRIPT_DRAFT) {
                const sql = await readTextFile(await this.abs(`${pageRel}/${entry.name}`));
                scripts.push({ name: entry.name, sql });
            }
        }
        scripts.sort((a, b) => this.naturalSort(a.name, b.name));
        return scripts;
    }

    async createNotebookPage(_sessionId: string, pageName: string): Promise<void> {
        await this.ensureDir(`${STORAGE_NOTEBOOK_FOLDER}/${pageName}`);
    }

    async deleteNotebookPage(_sessionId: string, pageName: string): Promise<void> {
        const pageDir = await this.abs(`${STORAGE_NOTEBOOK_FOLDER}/${pageName}`);
        if (await exists(pageDir)) {
            await remove(pageDir, { recursive: true });
        }
    }

    async loadNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<ScriptData> {
        const scriptFile = await this.abs(`${STORAGE_NOTEBOOK_FOLDER}/${pageName}/${scriptName}`);
        if (!(await exists(scriptFile))) {
            throw new Error(`Script not found: session ${sessionId}, page ${pageName}, script ${scriptName}`);
        }
        const sql = await readTextFile(scriptFile);
        return { name: scriptName, sql };
    }

    async saveNotebookScript(
        _sessionId: string,
        pageName: string,
        scriptName: string,
        sql: string
    ): Promise<void> {
        await this.ensureDir(`${STORAGE_NOTEBOOK_FOLDER}/${pageName}`);
        const scriptFile = await this.abs(`${STORAGE_NOTEBOOK_FOLDER}/${pageName}/${scriptName}`);
        await writeTextFile(scriptFile, sql);
    }

    async deleteNotebookScript(_sessionId: string, pageName: string, scriptName: string): Promise<void> {
        const scriptFile = await this.abs(`${STORAGE_NOTEBOOK_FOLDER}/${pageName}/${scriptName}`);
        if (await exists(scriptFile)) {
            await remove(scriptFile);
        }
    }

    async loadNotebookScriptDraft(_sessionId: string): Promise<string | null> {
        const draftFile = await this.abs(`${STORAGE_NOTEBOOK_FOLDER}/${STORAGE_SCRIPT_DRAFT}`);
        if (!(await exists(draftFile))) {
            return null;
        }
        return await readTextFile(draftFile);
    }

    async saveNotebookScriptDraft(_sessionId: string, sql: string): Promise<void> {
        await this.ensureDir(STORAGE_NOTEBOOK_FOLDER);
        const draftFile = await this.abs(`${STORAGE_NOTEBOOK_FOLDER}/${STORAGE_SCRIPT_DRAFT}`);
        await writeTextFile(draftFile, sql);
    }

    async clearAllStorage(): Promise<void> {
        // No-op: like deleteSession, this never touches the user-owned folder on disk. "Clear all
        // storage" only resets the OPFS root (registry + OPFS-backed sessions); native sessions are
        // simply unregistered when the manifest is wiped, and their files stay put on disk.
    }
}
