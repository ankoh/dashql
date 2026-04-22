import { type StorageBackend, type SessionData, type PageData, type ScriptData, type SessionEntry, type StorageManifest, STORAGE_MANIFEST_FILE, STORAGE_SESSIONS_FOLDER, STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT, STORAGE_SCRIPT_SCHEMA } from './storage_backend.js';

export class OPFSStorageBackend implements StorageBackend {
    private rootHandle: FileSystemDirectoryHandle | null = null;

    getSchemaPrefix(): string {
        return 'opfs://';
    }

    constructSessionPath(sessionId: string): string {
        return `opfs://${STORAGE_SESSIONS_FOLDER}/${sessionId}`;
    }

    parseSessionPath(sessionPath: string): string {
        // Extract the relative path from fully qualified path
        // "opfs://sessions/uuid" -> "sessions/uuid"
        const prefix = this.getSchemaPrefix();
        if (sessionPath.startsWith(prefix)) {
            return sessionPath.substring(prefix.length);
        }
        // Fallback for legacy paths without schema
        return sessionPath;
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

            // Validate and migrate legacy paths
            let needsMigration = false;
            const migratedSessions = manifest.sessions.map((entry: SessionEntry) => {
                if (!entry.path) {
                    throw new Error('Invalid manifest format: each session must have path');
                }
                // Migrate legacy paths (UUID only) to fully qualified paths
                if (!entry.path.includes('://')) {
                    needsMigration = true;
                    return {
                        ...entry,
                        path: this.constructSessionPath(entry.path)
                    };
                }
                return entry;
            });

            // Write back migrated manifest if needed
            if (needsMigration) {
                manifest.sessions = migratedSessions;
                const manifestFile = await root.getFileHandle(manifestPath, { create: true });
                const writable = await manifestFile.createWritable();
                await writable.write(JSON.stringify(manifest, null, 2));
                await writable.close();
            }

            return migratedSessions;
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
        const relativePath = this.parseSessionPath(sessionPath);
        const sessionDir = await this.getSessionDir(relativePath, false);
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
        const relativePath = this.parseSessionPath(sessionPath);
        const sessionDir = await this.getSessionDir(relativePath, true);
        const metaFile = await sessionDir.getFileHandle(STORAGE_SESSION_FILE, { create: true });
        const writable = await metaFile.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();

        await this.updateManifest(sessionPath, 'add');
    }

    async deleteSession(sessionPath: string): Promise<void> {
        const relativePath = this.parseSessionPath(sessionPath);
        const root = this.ensureInitialized();

        try {
            const sessionsDir = await root.getDirectoryHandle(STORAGE_SESSIONS_FOLDER, { create: false });
            // Extract just the UUID from the relative path (sessions/uuid -> uuid)
            const uuid = relativePath.split('/').pop() || relativePath;
            await sessionsDir.removeEntry(uuid, { recursive: true });
        } catch (error) {
            // If sessions folder or session doesn't exist, that's fine - it's already deleted
            if ((error as any).name === 'NotFoundError') {
                console.log(`Session ${sessionPath} not found in storage, treating as already deleted`);
            } else {
                throw error;
            }
        }

        // Always try to update manifest even if session wasn't found
        // (in case manifest still has a stale reference)
        await this.updateManifest(sessionPath, 'remove');
    }

    async loadSessionSchema(sessionPath: string): Promise<string | null> {
        try {
            const relativePath = this.parseSessionPath(sessionPath);
            const sessionDir = await this.getSessionDir(relativePath, false);
            const schemaFile = await sessionDir.getFileHandle(STORAGE_SCRIPT_SCHEMA, { create: false });
            const file = await schemaFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveSessionSchema(sessionPath: string, sql: string): Promise<void> {
        const relativePath = this.parseSessionPath(sessionPath);
        const sessionDir = await this.getSessionDir(relativePath, true);
        const schemaFile = await sessionDir.getFileHandle(STORAGE_SCRIPT_SCHEMA, { create: true });
        const writable = await schemaFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async loadNotebookPages(sessionPath: string): Promise<PageData[]> {
        const relativePath = this.parseSessionPath(sessionPath);
        const sessionDir = await this.getSessionDir(relativePath, false);
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
        const relativePath = this.parseSessionPath(sessionPath);
        const sessionDir = await this.getSessionDir(relativePath, true);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: true });
        await notebookDir.getDirectoryHandle(pageName, { create: true });
    }

    async deleteNotebookPage(sessionPath: string, pageName: string): Promise<void> {
        const relativePath = this.parseSessionPath(sessionPath);
        const sessionDir = await this.getSessionDir(relativePath, false);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER);
        await notebookDir.removeEntry(pageName, { recursive: true });
    }


    async loadNotebookScript(sessionPath: string, pageName: string, scriptName: string): Promise<ScriptData> {
        const relativePath = this.parseSessionPath(sessionPath);
        const pageDir = await this.getPageDir(relativePath, pageName, false);

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
        const relativePath = this.parseSessionPath(sessionPath);
        const pageDir = await this.getPageDir(relativePath, pageName, true);
        const fileHandle = await pageDir.getFileHandle(scriptName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async deleteNotebookScript(sessionPath: string, pageName: string, scriptName: string): Promise<void> {
        const relativePath = this.parseSessionPath(sessionPath);
        const pageDir = await this.getPageDir(relativePath, pageName, false);
        await pageDir.removeEntry(scriptName);
    }

    async reorderNotebookScript(
        sessionPath: string,
        pageName: string,
        orderedScriptNames: string[]
    ): Promise<void> {
        const relativePath = this.parseSessionPath(sessionPath);
        const pageDir = await this.getPageDir(relativePath, pageName, false);

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
            const relativePath = this.parseSessionPath(sessionPath);
            const sessionDir = await this.getSessionDir(relativePath, false);
            const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: false });
            const draftFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_DRAFT, { create: false });
            const file = await draftFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveNotebookScriptDraft(sessionPath: string, sql: string): Promise<void> {
        const relativePath = this.parseSessionPath(sessionPath);
        const sessionDir = await this.getSessionDir(relativePath, true);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: true });
        const draftFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_DRAFT, { create: true });
        const writable = await draftFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async clearAllStorage(): Promise<void> {
        const root = this.ensureInitialized();

        // Step 1: Load manifest to get all session paths
        let sessionPaths: string[] = [];
        try {
            const sessions = await this.listSessions(STORAGE_MANIFEST_FILE);
            sessionPaths = sessions.map(s => s.path);
            console.log(`Found ${sessionPaths.length} sessions in manifest`);
        } catch (error) {
            // If manifest doesn't exist or fails to load, we'll try to clean up what we can find
            console.warn('Could not load manifest during clearAllStorage:', error);
        }

        // Step 2: Clear the manifest (reset sessions to empty array) FIRST
        // This ensures the app won't try to restore sessions even if directory cleanup fails
        try {
            const emptyManifest: StorageManifest = { sessions: [] };
            const manifestFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: true });
            const writable = await manifestFile.createWritable();
            await writable.write(JSON.stringify(emptyManifest, null, 2));
            await writable.close();
            console.log('Manifest cleared (reset to empty sessions array)');
        } catch (error) {
            console.warn('Failed to clear manifest:', error);
        }

        // Step 3: Delete the entire sessions folder
        try {
            await root.removeEntry(STORAGE_SESSIONS_FOLDER, { recursive: true });
            console.log('Deleted sessions folder');
        } catch (error) {
            console.warn('Failed to delete sessions folder:', error);
        }
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
        relativePath: string,
        create: boolean
    ): Promise<FileSystemDirectoryHandle> {
        const root = this.ensureInitialized();
        // relativePath is like "sessions/uuid", split it
        const parts = relativePath.split('/');

        let currentDir = root;
        for (const part of parts) {
            if (part) {
                currentDir = await currentDir.getDirectoryHandle(part, { create });
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
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create });
        return await notebookDir.getDirectoryHandle(pageName, { create });
    }
}
