import {
    type StorageBackend,
    type SessionRegistryBackend,
    type SessionData,
    type PageData,
    type ScriptData,
    type SessionEntry,
    type AppSettings,
    StorageBackendType,
    STORAGE_MANIFEST_FILE,
} from './storage_backend.js';
import { NativeStorageBackend } from './native_storage_backend.js';
import { type SessionLocation, locationFromEntry } from './session_locator.js';
import { grantFsScope } from './native_fs_scope.js';
import { copySession, verifySession } from './storage_migration.js';
import type { Logger } from '../logger/logger.js';

const LOG_CTX = 'composite_storage_backend';

/// A storage backend that routes by per-session location.
///
/// The OPFS root manifest is the single registry of *every* session; registry-level operations
/// (listing sessions, app settings, clear-all) therefore always go to OPFS. Per-session operations
/// are routed by the session UUID to whichever backend physically holds that session's files:
///   - OPFS sessions -> the shared OPFS backend (`sessions/<uuid>/…`).
///   - Native sessions -> a per-session `NativeStorageBackend` bound to the recorded directory.
///
/// Native filesystem scope is re-granted lazily (and idempotently) the first time a native session
/// is touched, since Tauri's runtime scope is lost across reloads and the manifest is the source of
/// truth for which directories belong to dashql.
export class CompositeStorageBackend implements SessionRegistryBackend {
    /// The OPFS backend, which owns the session registry
    private readonly opfs: SessionRegistryBackend;
    /// uuid -> physical location, built from the manifest at init and kept in sync on writes
    private readonly locations: Map<string, SessionLocation>;
    /// Cached per-session native backends, keyed by uuid
    private readonly nativeCache: Map<string, NativeStorageBackend>;
    /// Native directories whose fs scope has already been granted this session
    private readonly grantedScopes: Set<string>;
    /// The logger
    private readonly logger: Logger;

    constructor(opfs: SessionRegistryBackend, logger: Logger) {
        this.opfs = opfs;
        this.locations = new Map();
        this.nativeCache = new Map();
        this.grantedScopes = new Set();
        this.logger = logger;
    }

    getBackendType(): StorageBackendType {
        return StorageBackendType.OPFS;
    }

    async initialize(): Promise<void> {
        await this.opfs.initialize?.();
        await this.refreshLocations();
    }

    /// Rebuild the uuid -> location map from the OPFS root manifest and re-grant native fs scopes.
    ///
    /// Called at init (and after relocate, before reload re-runs init). Granting scope here, before
    /// any native session is read, satisfies "grant before read" without a separate boot step.
    async refreshLocations(): Promise<void> {
        const sessions = await this.opfs.listSessions(STORAGE_MANIFEST_FILE);
        this.locations.clear();
        for (const entry of sessions) {
            this.locations.set(entry.path, locationFromEntry(entry));
        }
        for (const loc of this.locations.values()) {
            if (loc.type === StorageBackendType.Native && loc.nativePath) {
                await this.ensureScope(loc.nativePath);
            }
        }
    }

    /// Grant the native fs scope for a directory exactly once per session.
    private async ensureScope(dir: string): Promise<void> {
        if (this.grantedScopes.has(dir)) {
            return;
        }
        try {
            await grantFsScope(dir);
            this.grantedScopes.add(dir);
        } catch (e: any) {
            // A failed grant means subsequent native reads/writes for this directory will fail with
            // a permission error. Log it, but don't poison the whole restore - other sessions are
            // independent. We deliberately don't mark the scope as granted so a later access retries.
            this.logger.error('failed to grant native fs scope', { dir, error: String(e?.message ?? e) }, LOG_CTX);
        }
    }

    /// The current known location for a session (defaulting to OPFS for unknown UUIDs).
    private locationOf(sessionId: string): SessionLocation {
        return this.locations.get(sessionId) ?? { type: StorageBackendType.OPFS };
    }

    /// Resolve the backend that physically holds a session's files, granting scope as needed.
    private async backendFor(sessionId: string): Promise<StorageBackend> {
        const loc = this.locationOf(sessionId);
        if (loc.type === StorageBackendType.Native && loc.nativePath) {
            await this.ensureScope(loc.nativePath);
            let native = this.nativeCache.get(sessionId);
            if (!native) {
                native = new NativeStorageBackend(loc.nativePath);
                await native.initialize();
                this.nativeCache.set(sessionId, native);
            }
            return native;
        }
        return this.opfs;
    }

    // ---- Registry-level operations (always OPFS) ----------------------------------------------

    listSessions(manifestPath: string): Promise<SessionEntry[]> {
        return this.opfs.listSessions(manifestPath);
    }
    loadAppSettings(): Promise<AppSettings | null> {
        return this.opfs.loadAppSettings();
    }
    saveAppSettings(settings: AppSettings): Promise<void> {
        return this.opfs.saveAppSettings(settings);
    }

    upsertSessionEntry(entry: SessionEntry): Promise<void> {
        // Keep the in-memory location map consistent with what we persist.
        this.locations.set(entry.path, locationFromEntry(entry));
        return this.opfs.upsertSessionEntry(entry);
    }
    removeSessionEntry(sessionId: string): Promise<void> {
        this.locations.delete(sessionId);
        return this.opfs.removeSessionEntry(sessionId);
    }
    deleteSessionFiles(sessionId: string): Promise<void> {
        return this.backendFor(sessionId).then(b => {
            if (b === this.opfs) {
                return this.opfs.deleteSessionFiles(sessionId);
            }
            // For native sessions, the directory *is* the session.
            return b.deleteSession(sessionId);
        });
    }

    // ---- Per-session operations (routed by uuid) ----------------------------------------------

    async loadSession(sessionId: string): Promise<SessionData> {
        return (await this.backendFor(sessionId)).loadSession(sessionId);
    }

    async saveSessionManifest(sessionId: string, data: SessionData): Promise<void> {
        const backend = await this.backendFor(sessionId);
        await backend.saveSessionManifest(sessionId, data);
        // The OPFS backend updates the registry entry itself (storageType=opfs). The native backend
        // does not touch the registry, so when a session lives on disk we keep its registry entry
        // in sync here.
        const loc = this.locationOf(sessionId);
        if (loc.type === StorageBackendType.Native && loc.nativePath) {
            await this.opfs.upsertSessionEntry({
                path: sessionId,
                storageType: StorageBackendType.Native,
                nativePath: loc.nativePath,
            });
        }
    }

    async deleteSession(sessionId: string): Promise<void> {
        const backend = await this.backendFor(sessionId);
        if (backend === this.opfs) {
            // OPFS deletes files and removes the registry entry in one step.
            await this.opfs.deleteSession(sessionId);
        } else {
            // Native: remove the directory, then drop the registry entry kept in OPFS.
            await backend.deleteSession(sessionId);
            await this.opfs.removeSessionEntry(sessionId);
        }
        this.locations.delete(sessionId);
        this.nativeCache.delete(sessionId);
    }

    async loadSessionSchema(sessionId: string): Promise<string | null> {
        return (await this.backendFor(sessionId)).loadSessionSchema(sessionId);
    }
    async saveSessionSchema(sessionId: string, sql: string): Promise<void> {
        return (await this.backendFor(sessionId)).saveSessionSchema(sessionId, sql);
    }
    async loadSessionFunctions(sessionId: string): Promise<string | null> {
        return (await this.backendFor(sessionId)).loadSessionFunctions(sessionId);
    }
    async saveSessionFunctions(sessionId: string, sql: string): Promise<void> {
        return (await this.backendFor(sessionId)).saveSessionFunctions(sessionId, sql);
    }
    async loadNotebookPages(sessionId: string): Promise<PageData[]> {
        return (await this.backendFor(sessionId)).loadNotebookPages(sessionId);
    }
    async createNotebookPage(sessionId: string, pageName: string): Promise<void> {
        return (await this.backendFor(sessionId)).createNotebookPage(sessionId, pageName);
    }
    async deleteNotebookPage(sessionId: string, pageName: string): Promise<void> {
        return (await this.backendFor(sessionId)).deleteNotebookPage(sessionId, pageName);
    }
    async loadNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<ScriptData> {
        return (await this.backendFor(sessionId)).loadNotebookScript(sessionId, pageName, scriptName);
    }
    async saveNotebookScript(sessionId: string, pageName: string, scriptName: string, sql: string): Promise<void> {
        return (await this.backendFor(sessionId)).saveNotebookScript(sessionId, pageName, scriptName, sql);
    }
    async deleteNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<void> {
        return (await this.backendFor(sessionId)).deleteNotebookScript(sessionId, pageName, scriptName);
    }
    async reorderNotebookScript(sessionId: string, pageName: string, orderedScriptNames: string[]): Promise<void> {
        return (await this.backendFor(sessionId)).reorderNotebookScript(sessionId, pageName, orderedScriptNames);
    }
    async loadNotebookScriptDraft(sessionId: string): Promise<string | null> {
        return (await this.backendFor(sessionId)).loadNotebookScriptDraft(sessionId);
    }
    async saveNotebookScriptDraft(sessionId: string, sql: string): Promise<void> {
        return (await this.backendFor(sessionId)).saveNotebookScriptDraft(sessionId, sql);
    }

    async clearAllStorage(): Promise<void> {
        // Clear native session directories first, then the OPFS root (registry + opfs sessions).
        for (const native of this.nativeCache.values()) {
            await native.clearAllStorage?.();
        }
        for (const [uuid, loc] of this.locations) {
            if (loc.type === StorageBackendType.Native && loc.nativePath && !this.nativeCache.has(uuid)) {
                const native = new NativeStorageBackend(loc.nativePath);
                await native.clearAllStorage?.();
            }
        }
        this.nativeCache.clear();
        this.locations.clear();
        await this.opfs.clearAllStorage?.();
    }

    /// The recorded location for a session (used by the UI to render a display path).
    getSessionLocation(sessionId: string): SessionLocation {
        return this.locationOf(sessionId);
    }

    /// Relocate a single OPFS session's files into a native directory.
    ///
    /// The registry entry stays in OPFS; only the files move. Steps:
    ///   1. Grant scope for, and initialize, the target directory.
    ///   2. Copy the session's files OPFS -> native (UUID preserved).
    ///   3. Verify the copy; on failure throw without touching OPFS.
    ///   4. Flip the OPFS registry entry to `location=native, nativePath=dir` and persist the
    ///      session manifest's `storageType`/`nativePath`.
    ///   5. Delete the OPFS copy of the session's files (NOT the registry entry).
    ///
    /// On any failure before step 4 the OPFS copy is left fully intact, so the caller can recover.
    async relocateSessionToNative(uuid: string, dir: string): Promise<void> {
        if (this.locationOf(uuid).type !== StorageBackendType.OPFS) {
            throw new Error(`Session ${uuid} is not an OPFS session`);
        }

        await this.ensureScope(dir);
        const native = new NativeStorageBackend(dir);
        await native.initialize();

        // 2. Copy. Stamp the session manifest with its new physical location as we write it.
        const sessionData = await this.opfs.loadSession(uuid);
        await copySession(uuid, this.opfs, native, this.logger);
        await native.saveSessionManifest(uuid, {
            ...sessionData,
            storageType: StorageBackendType.Native,
            nativePath: dir,
        });

        // 3. Verify before we touch OPFS.
        const ok = await verifySession(uuid, this.opfs, native);
        if (!ok) {
            throw new Error(`Relocation verification failed for session ${uuid} - keeping OPFS copy`);
        }

        // 4. Flip the registry entry + cache the new location/backend.
        await this.opfs.upsertSessionEntry({
            path: uuid,
            storageType: StorageBackendType.Native,
            nativePath: dir,
        });
        this.locations.set(uuid, { type: StorageBackendType.Native, nativePath: dir });
        this.nativeCache.set(uuid, native);

        // 5. Now it's safe to drop the OPFS copy of the files (registry entry stays).
        await this.opfs.deleteSessionFiles(uuid);
        this.logger.info('relocated session to native storage', { sessionId: uuid, dir }, LOG_CTX);
    }
}
