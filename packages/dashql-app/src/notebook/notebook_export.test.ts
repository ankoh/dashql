import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { encodeNotebookAsZip } from './notebook_export.js';
import { STORAGE_SESSION_FILE, StorageBackendType } from '../platform/storage/storage_backend.js';
import type { StorageBackend, SessionData } from '../platform/storage/storage_backend.js';

/// A minimal StorageBackend that serves a single stored session with no pages/draft. encodeNotebookAsZip
/// reads the session/pages/draft from here and rewrites only the connection params for sharing, so the
/// tests only care about what lands in dashql-session.json. The stored session name (if any) is passed
/// through untouched.
function makeBackend(sessionId: string, name?: string): StorageBackend {
    const sessionData = {
        sessionId,
        sessionPath: sessionId,
        ...(name ? { name } : {}),
        connectionParams: { dataless: {} },
        notebook: { originalFileName: 'notebook.sql' },
    } as unknown as SessionData;
    return {
        getBackendType: vi.fn(() => StorageBackendType.OPFS),
        loadSession: vi.fn().mockResolvedValue(sessionData),
        loadNotebookPages: vi.fn().mockResolvedValue([]),
        loadNotebookScriptDraft: vi.fn().mockResolvedValue(null),
    } as unknown as StorageBackend;
}

async function readSessionData(zipBlob: Blob): Promise<any> {
    const zip = await JSZip.loadAsync(zipBlob);
    const sessionFile = zip.file(STORAGE_SESSION_FILE);
    expect(sessionFile).not.toBeNull();
    return JSON.parse(await sessionFile!.async('text'));
}

describe('encodeNotebookAsZip', () => {
    const connectionParams = { dataless: {} };

    it('carries the stored session name through so a shared link restores under the same label', async () => {
        const zipBlob = await encodeNotebookAsZip(makeBackend('uuid-1', 'My Analysis'), 'uuid-1', connectionParams);
        const session = await readSessionData(zipBlob);
        expect(session.name).toBe('My Analysis');
    });

    it('omits the name when the stored session was never named', async () => {
        const zipBlob = await encodeNotebookAsZip(makeBackend('uuid-1'), 'uuid-1', connectionParams);
        const session = await readSessionData(zipBlob);
        expect('name' in session).toBe(false);
    });

    it('shares the salesforce identity without the consumer secret when connection info is included', async () => {
        const sfParams = {
            salesforce: {
                hyperProtocol: 'V3_HTTP',
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                appConsumerSecret: 'super-secret',
                login: 'user@example.com',
            },
        };
        const zipBlob = await encodeNotebookAsZip(makeBackend('uuid-1'), 'uuid-1', sfParams, true);
        const session = await readSessionData(zipBlob);
        expect(session.connectionParams.salesforce.appConsumerKey).toBe('consumer-key');
        expect(session.connectionParams.salesforce.login).toBe('user@example.com');
        expect(session.connectionParams.salesforce.appConsumerSecret).toBe('');
    });

    it('drops the login hint but keeps the rest of the salesforce identity when withLoginHint is off', async () => {
        const sfParams = {
            salesforce: {
                hyperProtocol: 'V3_HTTP',
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                appConsumerSecret: 'super-secret',
                login: 'user@example.com',
            },
        };
        const zipBlob = await encodeNotebookAsZip(makeBackend('uuid-1'), 'uuid-1', sfParams, true, false);
        const session = await readSessionData(zipBlob);
        expect(session.connectionParams.salesforce.appConsumerKey).toBe('consumer-key');
        expect(session.connectionParams.salesforce.login).toBe('');
        expect(session.connectionParams.salesforce.appConsumerSecret).toBe('');
    });

    it('drops all connection info to a dataless session when the toggle is off', async () => {
        const sfParams = {
            salesforce: {
                hyperProtocol: 'V3_HTTP',
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                appConsumerSecret: 'super-secret',
                login: 'user@example.com',
            },
        };
        const zipBlob = await encodeNotebookAsZip(makeBackend('uuid-1'), 'uuid-1', sfParams, false);
        const session = await readSessionData(zipBlob);
        expect('salesforce' in session.connectionParams).toBe(false);
        expect('dataless' in session.connectionParams).toBe(true);
    });
});
