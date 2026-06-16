import { type StorageBackend, type SessionData, type PageData, type ScriptData, type SessionEntry, type AppSettings, StorageBackendType, STORAGE_SESSIONS_FOLDER } from './storage_backend.js';

/// Stub for the native filesystem storage backend.
/// All operations throw - the native backend is not yet implemented.
export class NativeStorageBackend implements StorageBackend {
    getBackendType(): StorageBackendType {
        return StorageBackendType.Native;
    }

    getSchemaPrefix(): string {
        return 'file://';
    }

    constructSessionPath(sessionId: string): string {
        return `file://${STORAGE_SESSIONS_FOLDER}/${sessionId}`;
    }

    parseSessionPath(sessionPath: string): string {
        const prefix = this.getSchemaPrefix();
        if (sessionPath.startsWith(prefix)) {
            return sessionPath.substring(prefix.length);
        }
        return sessionPath;
    }

    private notImplemented(): never {
        throw new Error('NativeStorageBackend is not implemented yet');
    }

    async listSessions(_manifestPath: string): Promise<SessionEntry[]> { this.notImplemented(); }
    async loadAppSettings(): Promise<AppSettings | null> { this.notImplemented(); }
    async saveAppSettings(_settings: AppSettings): Promise<void> { this.notImplemented(); }
    async loadSession(_sessionPath: string): Promise<SessionData> { this.notImplemented(); }
    async saveSessionManifest(_sessionPath: string, _data: SessionData): Promise<void> { this.notImplemented(); }
    async deleteSession(_sessionPath: string): Promise<void> { this.notImplemented(); }
    async loadSessionSchema(_sessionPath: string): Promise<string | null> { this.notImplemented(); }
    async saveSessionSchema(_sessionPath: string, _sql: string): Promise<void> { this.notImplemented(); }
    async loadSessionFunctions(_sessionPath: string): Promise<string | null> { this.notImplemented(); }
    async saveSessionFunctions(_sessionPath: string, _sql: string): Promise<void> { this.notImplemented(); }
    async loadNotebookPages(_sessionPath: string): Promise<PageData[]> { this.notImplemented(); }
    async createNotebookPage(_sessionPath: string, _pageName: string): Promise<void> { this.notImplemented(); }
    async deleteNotebookPage(_sessionPath: string, _pageName: string): Promise<void> { this.notImplemented(); }
    async loadNotebookScript(_sessionPath: string, _pageName: string, _scriptName: string): Promise<ScriptData> { this.notImplemented(); }
    async saveNotebookScript(_sessionPath: string, _pageName: string, _scriptName: string, _sql: string): Promise<void> { this.notImplemented(); }
    async deleteNotebookScript(_sessionPath: string, _pageName: string, _scriptName: string): Promise<void> { this.notImplemented(); }
    async reorderNotebookScript(_sessionPath: string, _pageName: string, _orderedScriptNames: string[]): Promise<void> { this.notImplemented(); }
    async loadNotebookScriptDraft(_sessionPath: string): Promise<string | null> { this.notImplemented(); }
    async saveNotebookScriptDraft(_sessionPath: string, _sql: string): Promise<void> { this.notImplemented(); }
    async clearAllStorage(): Promise<void> { this.notImplemented(); }
}
