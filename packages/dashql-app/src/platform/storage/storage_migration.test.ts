import { describe, it, expect, beforeEach } from 'vitest';
import { copySession, verifySession } from './storage_migration.js';
import {
    type StorageBackend,
    type SessionData,
    type PageData,
    type ScriptData,
    type SessionEntry,
    type AppSettings,
    StorageBackendType,
} from './storage_backend.js';
import { TestLogger } from '../logger/test_logger.js';

/// A minimal in-memory StorageBackend used to drive single-session copy tests.
/// Per-session ops are keyed by the bare session UUID (no storage prefix anymore).
class MemoryBackend implements StorageBackend {
    private readonly type: StorageBackendType;
    private appSettings: AppSettings | null = null;
    private sessions = new Map<string, SessionData>();
    private schema = new Map<string, string>();
    private functions = new Map<string, string>();
    private drafts = new Map<string, string>();
    private pages = new Map<string, Map<string, Map<string, string>>>();

    constructor(type: StorageBackendType) {
        this.type = type;
    }

    getBackendType(): StorageBackendType { return this.type; }

    async listSessions(): Promise<SessionEntry[]> {
        return [...this.sessions.keys()].sort().map(path => ({ path }));
    }
    async loadAppSettings(): Promise<AppSettings | null> { return this.appSettings; }
    async saveAppSettings(settings: AppSettings): Promise<void> { this.appSettings = settings; }
    async loadSession(sessionId: string): Promise<SessionData> {
        const data = this.sessions.get(sessionId);
        if (!data) throw new Error(`No session ${sessionId}`);
        return data;
    }
    async saveSessionManifest(sessionId: string, data: SessionData): Promise<void> {
        this.sessions.set(sessionId, data);
    }
    async deleteSession(sessionId: string): Promise<void> {
        this.sessions.delete(sessionId);
        this.schema.delete(sessionId);
        this.functions.delete(sessionId);
        this.drafts.delete(sessionId);
        this.pages.delete(sessionId);
    }
    async loadSessionSchema(sessionId: string): Promise<string | null> { return this.schema.get(sessionId) ?? null; }
    async saveSessionSchema(sessionId: string, sql: string): Promise<void> { this.schema.set(sessionId, sql); }
    async loadSessionFunctions(sessionId: string): Promise<string | null> { return this.functions.get(sessionId) ?? null; }
    async saveSessionFunctions(sessionId: string, sql: string): Promise<void> { this.functions.set(sessionId, sql); }
    async loadNotebookPages(sessionId: string): Promise<PageData[]> {
        const sessionPages = this.pages.get(sessionId);
        if (!sessionPages) return [];
        return [...sessionPages.entries()].map(([name, scripts]) => ({
            name,
            scripts: [...scripts.entries()].map(([sn, sql]): ScriptData => ({ name: sn, sql })),
        }));
    }
    async createNotebookPage(sessionId: string, pageName: string): Promise<void> {
        const sessionPages = this.pages.get(sessionId) ?? new Map();
        if (!sessionPages.has(pageName)) sessionPages.set(pageName, new Map());
        this.pages.set(sessionId, sessionPages);
    }
    async deleteNotebookPage(sessionId: string, pageName: string): Promise<void> {
        this.pages.get(sessionId)?.delete(pageName);
    }
    async loadNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<ScriptData> {
        const sql = this.pages.get(sessionId)?.get(pageName)?.get(scriptName);
        if (sql == null) throw new Error('Script not found');
        return { name: scriptName, sql };
    }
    async saveNotebookScript(sessionId: string, pageName: string, scriptName: string, sql: string): Promise<void> {
        const sessionPages = this.pages.get(sessionId) ?? new Map();
        const page = sessionPages.get(pageName) ?? new Map();
        page.set(scriptName, sql);
        sessionPages.set(pageName, page);
        this.pages.set(sessionId, sessionPages);
    }
    async deleteNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<void> {
        this.pages.get(sessionId)?.get(pageName)?.delete(scriptName);
    }
    async reorderNotebookScript(): Promise<void> { /* not exercised by migration */ }
    async loadNotebookScriptDraft(sessionId: string): Promise<string | null> { return this.drafts.get(sessionId) ?? null; }
    async saveNotebookScriptDraft(sessionId: string, sql: string): Promise<void> { this.drafts.set(sessionId, sql); }
}

function seedSession(backend: MemoryBackend, id: string): Promise<void> {
    return (async () => {
        await backend.saveSessionManifest(id, {
            sessionId: id,
            title: `Session ${id}`,
            connectionParams: { dataless: {} },
            notebook: {},
        });
        await backend.saveSessionSchema(id, `-- schema ${id}`);
        await backend.saveSessionFunctions(id, `-- functions ${id}`);
        await backend.createNotebookPage(id, 'page-1');
        await backend.saveNotebookScript(id, 'page-1', '01-script.sql', `SELECT '${id}-1';`);
        await backend.saveNotebookScript(id, 'page-1', '02-script.sql', `SELECT '${id}-2';`);
        await backend.createNotebookPage(id, 'page-2');
        await backend.saveNotebookScript(id, 'page-2', '01-script.sql', `SELECT '${id}-3';`);
        await backend.saveNotebookScriptDraft(id, `-- draft ${id}`);
    })();
}

describe('storage_migration', () => {
    let source: MemoryBackend;
    let target: MemoryBackend;
    let logger: TestLogger;
    const UUID = 'aaa';

    beforeEach(async () => {
        source = new MemoryBackend(StorageBackendType.OPFS);
        target = new MemoryBackend(StorageBackendType.Native);
        logger = new TestLogger();
        await seedSession(source, UUID);
    });

    it('copies one session to the target, preserving the UUID', async () => {
        const result = await copySession(UUID, source, target, logger);
        expect(result.sessionCount).toBe(1);
        // 1 manifest + 1 schema + 1 functions + 3 scripts + 1 draft = 7
        expect(result.fileCount).toBe(7);

        const targetSessions = await target.listSessions();
        expect(targetSessions.map(s => s.path)).toEqual([UUID]);
    });

    it('keeps the same sessionId on the copy', async () => {
        await copySession(UUID, source, target, logger);
        const migrated = await target.loadSession(UUID);
        expect(migrated.sessionId).toBe(UUID);
        expect(migrated.title).toBe('Session aaa');
    });

    it('copies schema, functions, scripts and draft contents verbatim', async () => {
        await copySession(UUID, source, target, logger);
        expect(await target.loadSessionSchema(UUID)).toBe('-- schema aaa');
        expect(await target.loadSessionFunctions(UUID)).toBe('-- functions aaa');
        expect(await target.loadNotebookScriptDraft(UUID)).toBe('-- draft aaa');

        const pages = await target.loadNotebookPages(UUID);
        const scriptCount = pages.reduce((n, p) => n + p.scripts.length, 0);
        expect(scriptCount).toBe(3);
        const script = await target.loadNotebookScript(UUID, 'page-1', '01-script.sql');
        expect(script.sql).toBe("SELECT 'aaa-1';");
    });

    it('verifySession returns true for a complete copy', async () => {
        await copySession(UUID, source, target, logger);
        expect(await verifySession(UUID, source, target)).toBe(true);
    });

    it('verifySession returns false when the session is missing', async () => {
        expect(await verifySession(UUID, source, target)).toBe(false);
    });

    it('verifySession returns false when script counts mismatch', async () => {
        await copySession(UUID, source, target, logger);
        await target.deleteNotebookScript(UUID, 'page-1', '02-script.sql');
        expect(await verifySession(UUID, source, target)).toBe(false);
    });
});
