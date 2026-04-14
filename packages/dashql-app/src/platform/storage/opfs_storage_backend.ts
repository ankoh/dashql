import { type StorageBackend, type SessionData, type PageData, type ScriptData, type SessionEntry, type StorageManifest, STORAGE_MANIFEST_FILE, STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

export class OPFSStorageBackend implements StorageBackend {
    private rootHandle: FileSystemDirectoryHandle | null = null;

    async initialize(): Promise<void> {
        this.rootHandle = await navigator.storage.getDirectory();
    }

    private ensureInitialized(): FileSystemDirectoryHandle {
        if (!this.rootHandle) {
            throw new Error('OPFSStorageBackend not initialized. Call initialize() first.');
        }
        return this.rootHandle;
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

            // Validate that each entry has required fields
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

    async loadSession(sessionPath: string): Promise<SessionData> {
        const sessionDir = await this.getSessionDir(sessionPath, false);
        const metaFile = await sessionDir.getFileHandle(STORAGE_SESSION_FILE);
        const file = await metaFile.getFile();
        const text = await file.text();
        const data: SessionData = JSON.parse(text);

        // sessionId is required - will throw if missing
        if (!data.sessionId) {
            throw new Error(`Session at ${sessionPath} is missing required sessionId field. Please migrate the session or regenerate it.`);
        }

        return data;
    }

    async saveSession(sessionPath: string, data: SessionData): Promise<void> {
        const sessionDir = await this.getSessionDir(sessionPath, true);
        const metaFile = await sessionDir.getFileHandle(STORAGE_SESSION_FILE, { create: true });
        const writable = await metaFile.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();

        await this.updateManifest(sessionPath, 'add');
    }

    async deleteSession(sessionPath: string): Promise<void> {
        const root = this.ensureInitialized();
        await root.removeEntry(sessionPath, { recursive: true });
        await this.updateManifest(sessionPath, 'remove');
    }

    async loadNotebookPages(sessionPath: string): Promise<PageData[]> {
        const sessionDir = await this.getSessionDir(sessionPath, false);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: false });
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

    async createNotebookPage(sessionPath: string, pageName: string): Promise<void> {
        const sessionDir = await this.getSessionDir(sessionPath, true);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: true });
        await notebookDir.getDirectoryHandle(pageName, { create: true });
    }

    async deleteNotebookPage(sessionPath: string, pageName: string): Promise<void> {
        const sessionDir = await this.getSessionDir(sessionPath, false);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER);
        await notebookDir.removeEntry(pageName, { recursive: true });
    }


    async loadNotebookScript(sessionPath: string, pageName: string, scriptName: string): Promise<ScriptData> {
        const pageDir = await this.getPageDir(sessionPath, pageName, false);

        try {
            const fileHandle = await pageDir.getFileHandle(scriptName);
            const file = await fileHandle.getFile();
            const sql = await file.text();
            return { name: scriptName, sql };
        } catch {
            throw new Error(`Script not found: session ${sessionPath}, page ${pageName}, script ${scriptName}`);
        }
    }

    async saveNotebookScript(
        sessionPath: string,
        pageName: string,
        scriptName: string,
        sql: string
    ): Promise<void> {
        const pageDir = await this.getPageDir(sessionPath, pageName, true);
        const fileHandle = await pageDir.getFileHandle(scriptName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async deleteNotebookScript(sessionPath: string, pageName: string, scriptName: string): Promise<void> {
        const pageDir = await this.getPageDir(sessionPath, pageName, false);
        await pageDir.removeEntry(scriptName);
    }

    async reorderNotebookScript(
        sessionPath: string,
        pageName: string,
        orderedScriptNames: string[]
    ): Promise<void> {
        const pageDir = await this.getPageDir(sessionPath, pageName, false);

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

    async loadNotebookScriptDraft(sessionPath: string): Promise<string | null> {
        try {
            const sessionDir = await this.getSessionDir(sessionPath, false);
            const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: false });
            const draftFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_DRAFT, { create: false });
            const file = await draftFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveNotebookScriptDraft(sessionPath: string, sql: string): Promise<void> {
        const sessionDir = await this.getSessionDir(sessionPath, true);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: true });
        const draftFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_DRAFT, { create: true });
        const writable = await draftFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    private async updateManifest(sessionPath: string, operation: 'add' | 'remove'): Promise<void> {
        const root = this.ensureInitialized();

        let manifest: StorageManifest;
        try {
            const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: false });
            const file = await indexFile.getFile();
            const text = await file.text();
            manifest = JSON.parse(text);

            if (!manifest.sessions || !Array.isArray(manifest.sessions)) {
                throw new Error('Invalid manifest format: sessions must be an array');
            }
        } catch (error) {
            // If file doesn't exist, create new manifest
            if ((error as any).name === 'NotFoundError') {
                manifest = { sessions: [] };
            } else {
                throw error;
            }
        }

        if (operation === 'add') {
            // Check if session already exists
            const existingIndex = manifest.sessions.findIndex((s: SessionEntry) => s.path === sessionPath);

            if (existingIndex < 0) {
                // Add new entry
                manifest.sessions.push({
                    path: sessionPath
                });
                // Sort by path
                manifest.sessions.sort((a: SessionEntry, b: SessionEntry) => a.path.localeCompare(b.path));
            }
            // If session already exists, no need to update (no title field anymore)
        } else {
            // Remove session
            manifest.sessions = manifest.sessions.filter((s: SessionEntry) => s.path !== sessionPath);
        }

        const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: true });
        const writable = await indexFile.createWritable();
        await writable.write(JSON.stringify(manifest, null, 2));
        await writable.close();
    }

    private async getSessionDir(
        sessionPath: string,
        create: boolean
    ): Promise<FileSystemDirectoryHandle> {
        const root = this.ensureInitialized();
        return await root.getDirectoryHandle(sessionPath, { create });
    }

    private async getPageDir(
        sessionPath: string,
        pageName: string,
        create: boolean
    ): Promise<FileSystemDirectoryHandle> {
        const sessionDir = await this.getSessionDir(sessionPath, create);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create });
        return await notebookDir.getDirectoryHandle(pageName, { create });
    }
}
