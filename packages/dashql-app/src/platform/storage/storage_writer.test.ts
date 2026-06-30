import * as core from '../../core/index.js';

import { beforeAll, afterEach, describe, expect, it } from 'vitest';

import { type StorageBackend, type SessionData, type PageData, type ScriptData, StorageBackendType } from './storage_backend.js';
import { StorageWriter, WRITE_SESSION_MANIFEST, groupSessionWrites } from './storage_writer.js';
import { type ConnectionState } from '../../connection/connection_state.js';
import { createDatalessConnectionState } from '../../connection/dataless/dataless_connection_state.js';
import { Logger } from '../logger/logger.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

/// A minimal in-memory backend that records how often each session manifest is written.
class CountingBackend implements StorageBackend {
    sessions = new Map<string, SessionData>();
    saveCount = 0;

    getBackendType(): StorageBackendType { return StorageBackendType.OPFS; }

    async listSessions(): Promise<any[]> { return []; }
    async loadAppSettings(): Promise<any> { return null; }
    async saveAppSettings(): Promise<void> { }

    async loadSession(sessionId: string): Promise<SessionData> {
        const data = this.sessions.get(sessionId);
        if (!data) throw new Error(`No session ${sessionId}`);
        // Return a deep copy so callers can't mutate our stored copy in place.
        return JSON.parse(JSON.stringify(data));
    }
    async saveSessionManifest(sessionId: string, data: SessionData): Promise<void> {
        this.saveCount += 1;
        this.sessions.set(sessionId, JSON.parse(JSON.stringify(data)));
    }
    async deleteSession(sessionId: string): Promise<void> { this.sessions.delete(sessionId); }

    async loadSessionSchema(): Promise<string | null> { return null; }
    async saveSessionSchema(): Promise<void> { }
    async loadSessionFunctions(): Promise<string | null> { return null; }
    async saveSessionFunctions(): Promise<void> { }
    async loadNotebookPages(): Promise<PageData[]> { return []; }
    async createNotebookPage(): Promise<void> { }
    async deleteNotebookPage(): Promise<void> { }
    async loadNotebookScript(): Promise<ScriptData> { return { name: '', sql: '' }; }
    async saveNotebookScript(): Promise<void> { }
    async deleteNotebookScript(): Promise<void> { }
    async loadNotebookScriptDraft(): Promise<string | null> { return null; }
    async saveNotebookScriptDraft(): Promise<void> { }
}

let dql: core.DashQL | null = null;
const logger = new NullLogger();

beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await core.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});

afterEach(() => {
    dql!.resetUnsafe();
});

function makeConnection(sessionId: string): ConnectionState {
    return { ...createDatalessConnectionState(dql!, new Map()), sessionId };
}

describe('StorageWriter session manifest writes', () => {
    it('skips rewriting the manifest when nothing changed', async () => {
        const backend = new CountingBackend();
        const writer = new StorageWriter(logger, backend);
        const conn = makeConnection('a0000000-0000-4000-8000-000000000001');
        const key = groupSessionWrites(conn.sessionId);

        // First write: nothing on disk yet, so it must persist.
        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [conn.sessionId, conn] });
        await writer.flush();
        expect(backend.saveCount).toBe(1);

        // Second write with identical content: should be skipped.
        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [conn.sessionId, conn] });
        await writer.flush();
        expect(backend.saveCount).toBe(1);
    });

    it('preserves createdAt across rewrites and writes again when content changes', async () => {
        const backend = new CountingBackend();
        const writer = new StorageWriter(logger, backend);
        const conn = makeConnection('a0000000-0000-4000-8000-000000000002');
        const key = groupSessionWrites(conn.sessionId);

        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [conn.sessionId, conn] });
        await writer.flush();
        const createdAt = backend.sessions.get(conn.sessionId)!.notebook.createdAt;
        expect(createdAt).toBeTruthy();

        // A change to a persisted field (title) must trigger a write that keeps the original createdAt.
        const renamed: ConnectionState = {
            ...conn,
            connectorInfo: { ...conn.connectorInfo, names: { ...conn.connectorInfo.names, fileShort: 'Renamed' } },
        };
        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [renamed.sessionId, renamed] });
        await writer.flush();
        expect(backend.saveCount).toBe(2);

        const persisted = backend.sessions.get(conn.sessionId)!;
        expect(persisted.title).toBe('Renamed');
        expect(persisted.notebook.createdAt).toBe(createdAt);
    });
});
