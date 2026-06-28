import { type SessionRegistryBackend, type SessionData, type PageData, type ScriptData, type SessionEntry, type StorageManifest, type AppSettings, StorageBackendType, STORAGE_MANIFEST_FILE, STORAGE_SESSIONS_FOLDER, STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT, STORAGE_SCRIPT_SCHEMA, STORAGE_SCRIPT_FUNCTIONS } from './storage_backend.js';

/// Origin Private File System storage backend.
///
/// This backend owns the session registry (the root manifest), which lists *every* session
/// regardless of where its files physically live. Sessions stored in OPFS keep their files under
/// `sessions/<uuid>/…`; sessions relocated to a native directory keep only a registry entry here
/// (their files live on disk, managed by `NativeStorageBackend`).
///
/// Every per-session method is keyed by the bare session UUID.
export class OPFSStorageBackend implements SessionRegistryBackend {
    private rootHandle: FileSystemDirectoryHandle | null = null;

    getBackendType(): StorageBackendType {
        return StorageBackendType.OPFS;
    }

    async initialize(): Promise<void> {
        this.rootHandle = await navigator.storage.getDirectory();
    }

    private ensureInitialized(): FileSystemDirectoryHandle {
        if (!this.rootHandle) {
            throw new Error('OPFSStorageBackend not initialized. Call initialize() first.');
        }
        return this.rootHandle;
    }

    /// The relative folder that holds a session's files, e.g. "sessions/<uuid>"
    private sessionRelPath(sessionId: string): string {
        return `${STORAGE_SESSIONS_FOLDER}/${sessionId}`;
    }

    /// Natural sort for strings with numeric components (e.g., "page-1" < "page-2" < "page-10")
    private naturalSort(a: string, b: string): number {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    async listSessions(manifestPath: string): Promise<SessionEntry[]> {
        const root = this.ensureInitialized();
        try {
            const indexFile = await root.getFileHandle(manifestPath, { create: false });
            const file = await indexFile.getFile();
            const text = await file.text();
            const manifest: StorageManifest = JSON.parse(text);

            if (!manifest.sessions || !Array.isArray(manifest.sessions)) {
                throw new Error('Invalid manifest format: sessions must be an array');
            }

            // Validate entries
            for (const entry of manifest.sessions) {
                if (!entry.path) {
                    throw new Error('Invalid manifest format: each session must have path');
                }
            }

            return manifest.sessions;
        } catch (error) {
            // If file doesn't exist, return empty array
            if ((error as any).name === 'NotFoundError') {
                return [];
            }
            // Re-throw other errors (including validation errors)
            throw error;
        }
    }

    async loadSession(sessionId: string): Promise<SessionData> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
        const metaFile = await sessionDir.getFileHandle(STORAGE_SESSION_FILE);
        const file = await metaFile.getFile();
        const text = await file.text();
        const data: SessionData = JSON.parse(text);

        // sessionId is required - will throw if missing
        if (!data.sessionId) {
            throw new Error(`Session ${sessionId} is missing required sessionId field. Please migrate the session or regenerate it.`);
        }

        return data;
    }

    async saveSessionManifest(sessionId: string, data: SessionData): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const metaFile = await sessionDir.getFileHandle(STORAGE_SESSION_FILE, { create: true });
        const writable = await metaFile.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();

        await this.upsertSessionEntry({ path: sessionId, storageType: StorageBackendType.OPFS });
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.deleteSessionFiles(sessionId);
        // Always try to update the manifest even if the session files weren't found
        // (in case the manifest still has a stale reference).
        await this.removeSessionEntry(sessionId);
    }

    /// Delete a session's files only, leaving the registry entry intact.
    async deleteSessionFiles(sessionId: string): Promise<void> {
        const relativePath = this.sessionRelPath(sessionId);
        const root = this.ensureInitialized();

        try {
            // Navigate to the parent directory, then remove the session entry
            const parts = relativePath.split('/').filter(p => p);
            if (parts.length > 0) {
                let parentDir: FileSystemDirectoryHandle = root;
                for (let i = 0; i < parts.length - 1; i++) {
                    parentDir = await parentDir.getDirectoryHandle(parts[i], { create: false });
                }
                await parentDir.removeEntry(parts[parts.length - 1], { recursive: true });
            }
        } catch (error) {
            // If sessions folder or session doesn't exist, that's fine - it's already deleted
            if ((error as any).name !== 'NotFoundError') {
                throw error;
            }
        }
    }

    async loadSessionSchema(sessionId: string): Promise<string | null> {
        try {
            const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
            const schemaFile = await sessionDir.getFileHandle(STORAGE_SCRIPT_SCHEMA, { create: false });
            const file = await schemaFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveSessionSchema(sessionId: string, sql: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const schemaFile = await sessionDir.getFileHandle(STORAGE_SCRIPT_SCHEMA, { create: true });
        const writable = await schemaFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async loadSessionFunctions(sessionId: string): Promise<string | null> {
        try {
            const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
            const functionsFile = await sessionDir.getFileHandle(STORAGE_SCRIPT_FUNCTIONS, { create: false });
            const file = await functionsFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveSessionFunctions(sessionId: string, sql: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const functionsFile = await sessionDir.getFileHandle(STORAGE_SCRIPT_FUNCTIONS, { create: true });
        const writable = await functionsFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async loadNotebookPages(sessionId: string): Promise<PageData[]> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false).catch((error) => {
            if ((error as any).name === 'NotFoundError') return null;
            throw error;
        });
        if (!sessionDir) {
            return [];
        }
        let notebookDir: FileSystemDirectoryHandle;
        try {
            notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return [];
            }
            throw error;
        }
        const pages: PageData[] = [];

        for await (const [name, handle] of notebookDir.entries()) {
            if (handle.kind === 'directory') {
                const scripts = await this.loadScriptsInPage(handle as FileSystemDirectoryHandle);
                pages.push({ name, scripts });
            }
        }
        pages.sort((a, b) => this.naturalSort(a.name, b.name));
        return pages;
    }

    private async loadScriptsInPage(pageDir: FileSystemDirectoryHandle): Promise<ScriptData[]> {
        const scripts: ScriptData[] = [];

        for await (const [name, handle] of pageDir.entries()) {
            if (handle.kind === 'file' && name.endsWith('.sql') && name !== STORAGE_SCRIPT_DRAFT) {
                const file = await (handle as FileSystemFileHandle).getFile();
                const sql = await file.text();
                scripts.push({ name, sql });
            }
        }
        scripts.sort((a, b) => this.naturalSort(a.name, b.name));
        return scripts;
    }

    async createNotebookPage(sessionId: string, pageName: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: true });
        await notebookDir.getDirectoryHandle(pageName, { create: true });
    }

    async deleteNotebookPage(sessionId: string, pageName: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER);
        await notebookDir.removeEntry(pageName, { recursive: true });
    }


    async loadNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<ScriptData> {
        const pageDir = await this.getPageDir(this.sessionRelPath(sessionId), pageName, false);

        try {
            const fileHandle = await pageDir.getFileHandle(scriptName);
            const file = await fileHandle.getFile();
            const sql = await file.text();
            return { name: scriptName, sql };
        } catch {
            throw new Error(`Script not found: session ${sessionId}, page ${pageName}, script ${scriptName}`);
        }
    }

    async saveNotebookScript(
        sessionId: string,
        pageName: string,
        scriptName: string,
        sql: string
    ): Promise<void> {
        const pageDir = await this.getPageDir(this.sessionRelPath(sessionId), pageName, true);
        const fileHandle = await pageDir.getFileHandle(scriptName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async deleteNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<void> {
        const pageDir = await this.getPageDir(this.sessionRelPath(sessionId), pageName, false);
        await pageDir.removeEntry(scriptName);
    }

    async reorderNotebookScript(
        sessionId: string,
        pageName: string,
        orderedScriptNames: string[]
    ): Promise<void> {
        const pageDir = await this.getPageDir(this.sessionRelPath(sessionId), pageName, false);

        // Load current scripts to validate
        const scripts = await this.loadScriptsInPage(pageDir);
        const scriptSet = new Set(scripts.map(s => s.name));

        // Validate all requested names exist
        for (const name of orderedScriptNames) {
            if (!scriptSet.has(name)) {
                throw new Error(`Script ${name} not found in page ${pageName}`);
            }
        }

        // Create a map of old names to script content
        const scriptMap = new Map(scripts.map(s => [s.name, s.sql]));

        // Rename each script with new numeric prefix in desired order
        const tempFiles: Array<{ tempName: string; finalName: string; sql: string }> = [];

        for (let i = 0; i < orderedScriptNames.length; i++) {
            const oldName = orderedScriptNames[i];
            const sql = scriptMap.get(oldName)!;
            const prefix = String(i + 1).padStart(2, '0');

            // Extract base name without old prefix
            const baseName = oldName.replace(/^\d+-/, '');
            const finalName = `${prefix}-${baseName}`;
            const tempName = `_temp-${i}.sql`;

            // Write to temporary file first
            const tempFile = await pageDir.getFileHandle(tempName, { create: true });
            const writable = await tempFile.createWritable();
            await writable.write(sql);
            await writable.close();

            tempFiles.push({ tempName, finalName, sql });
        }

        // Delete all original .sql files (but not draft)
        for await (const [name] of pageDir.entries()) {
            if (name.endsWith('.sql') && name !== STORAGE_SCRIPT_DRAFT && !name.startsWith('_temp-')) {
                await pageDir.removeEntry(name);
            }
        }

        // Rename temp files to final names
        for (const { tempName, finalName, sql } of tempFiles) {
            const finalFile = await pageDir.getFileHandle(finalName, { create: true });
            const writable = await finalFile.createWritable();
            await writable.write(sql);
            await writable.close();
            await pageDir.removeEntry(tempName);
        }
    }

    async loadNotebookScriptDraft(sessionId: string): Promise<string | null> {
        try {
            const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
            const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: false });
            const draftFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_DRAFT, { create: false });
            const file = await draftFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveNotebookScriptDraft(sessionId: string, sql: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: true });
        const draftFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_DRAFT, { create: true });
        const writable = await draftFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async clearAllStorage(): Promise<void> {
        const root = this.ensureInitialized();

        // Step 1: Clear the manifest (reset sessions to empty array) FIRST.
        // This ensures the app won't try to restore sessions even if directory cleanup fails.
        try {
            const emptyManifest: StorageManifest = { sessions: [] };
            const manifestFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: true });
            const writable = await manifestFile.createWritable();
            await writable.write(JSON.stringify(emptyManifest, null, 2));
            await writable.close();
        } catch (error) {
            console.warn('Failed to clear manifest:', error);
        }

        // Step 2: Delete the entire sessions folder
        try {
            await root.removeEntry(STORAGE_SESSIONS_FOLDER, { recursive: true });
        } catch (error) {
            console.warn('Failed to delete sessions folder:', error);
        }
    }

    async loadAppSettings(): Promise<AppSettings | null> {
        const root = this.ensureInitialized();
        try {
            const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: false });
            const file = await indexFile.getFile();
            const text = await file.text();
            const manifest: StorageManifest = JSON.parse(text);
            return manifest.appSettings ?? null;
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return null;
            }
            throw error;
        }
    }

    async saveAppSettings(settings: AppSettings): Promise<void> {
        const root = this.ensureInitialized();
        const manifest = await this.readManifest(root);
        manifest.appSettings = settings;
        await this.writeManifest(root, manifest);
    }

    private async readManifest(root: FileSystemDirectoryHandle): Promise<StorageManifest> {
        try {
            const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: false });
            const file = await indexFile.getFile();
            const text = await file.text();
            const manifest: StorageManifest = JSON.parse(text);
            if (!manifest.sessions || !Array.isArray(manifest.sessions)) {
                throw new Error('Invalid manifest format: sessions must be an array');
            }
            return manifest;
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return { sessions: [] };
            }
            throw error;
        }
    }

    private async writeManifest(root: FileSystemDirectoryHandle, manifest: StorageManifest): Promise<void> {
        const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: true });
        const writable = await indexFile.createWritable();
        await writable.write(JSON.stringify(manifest, null, 2));
        await writable.close();
    }

    /// Insert or replace a session's registry entry (matched by UUID), without touching files.
    async upsertSessionEntry(entry: SessionEntry): Promise<void> {
        const root = this.ensureInitialized();
        const manifest = await this.readManifest(root);

        const existingIndex = manifest.sessions.findIndex(s => s.path === entry.path);
        if (existingIndex < 0) {
            manifest.sessions.push(entry);
        } else {
            manifest.sessions[existingIndex] = entry;
        }
        manifest.sessions.sort((a, b) => a.path.localeCompare(b.path));

        await this.writeManifest(root, manifest);
    }

    /// Remove a session's registry entry (matched by UUID), without touching files.
    async removeSessionEntry(sessionId: string): Promise<void> {
        const root = this.ensureInitialized();
        const manifest = await this.readManifest(root);
        manifest.sessions = manifest.sessions.filter(s => s.path !== sessionId);
        await this.writeManifest(root, manifest);
    }

    private async getSessionDir(
        relativePath: string,
        create: boolean
    ): Promise<FileSystemDirectoryHandle> {
        const root = this.ensureInitialized();
        const parts = relativePath.split('/');
        let currentDir = root;
        let accumulated = '';
        for (const part of parts) {
            if (part) {
                accumulated = accumulated ? `${accumulated}/${part}` : part;
                try {
                    currentDir = await currentDir.getDirectoryHandle(part, { create });
                } catch (error) {
                    if ((error as any).name === 'NotFoundError') {
                        throw new Error(`Directory not found: opfs://${accumulated}`);
                    }
                    throw error;
                }
            }
        }
        return currentDir;
    }

    private async getPageDir(
        sessionPath: string,
        pageName: string,
        create: boolean
    ): Promise<FileSystemDirectoryHandle> {
        const sessionDir = await this.getSessionDir(sessionPath, create);
        try {
            const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create });
            return await notebookDir.getDirectoryHandle(pageName, { create });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                throw new Error(`Directory not found: opfs://${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}/${pageName}`);
            }
            throw error;
        }
    }
}
