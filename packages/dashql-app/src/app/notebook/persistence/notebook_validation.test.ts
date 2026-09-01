import { describe, it, expect } from 'vitest';
import {
    validateNotebookData,
    describeInvalidNotebook,
    describeNotebookValidationError,
    NotebookValidationError,
} from './notebook_validation.js';
import type { NotebookData, NotebookEntry } from './storage_backend.js';
import { ConnectorType } from '../connections/connector_info.js';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DATABASE_ID = '11111111-2222-3333-4444-555555555555';
const REMOTE_DATABASE_ID = '66666666-7777-8888-9999-aaaaaaaaaaaa';

function notebook(extra: Partial<NotebookData> = {}): NotebookData {
    return {
        formatVersion: 2,
        notebookId: UUID,
        mainDatabase: { databaseId: DATABASE_ID, params: { hyper: {} } as any },
        attachedDatabases: [],
        metadata: {},
        ...extra,
    } as NotebookData;
}

describe('validateNotebookData', () => {
    it('accepts a well-formed Hyper notebook', () => {
        expect(validateNotebookData(notebook())).toEqual({ ok: true });
    });

    it('accepts each known remote connector after the local database', () => {
        const local = { databaseId: DATABASE_ID, params: { hyper: { protocol: 'WASM' } } as any };
        const hyper = notebook({ mainDatabase: { databaseId: REMOTE_DATABASE_ID, params: { hyper: { protocol: 'V3_HTTP' } } as any }, attachedDatabases: [local] });
        const sf = notebook({ mainDatabase: { databaseId: REMOTE_DATABASE_ID, params: { salesforce: {} } as any }, attachedDatabases: [local] });
        const trino = notebook({ mainDatabase: { databaseId: REMOTE_DATABASE_ID, params: { trino: {} } as any }, attachedDatabases: [local] });
        expect(validateNotebookData(hyper).ok).toBe(true);
        expect(validateNotebookData(sf).ok).toBe(true);
        expect(validateNotebookData(trino).ok).toBe(true);
    });

    it('rejects removed connector metadata', () => {
        expect(validateNotebookData(notebook({ mainDatabase: { databaseId: DATABASE_ID, params: { duckdb: {} } as any } }))).toEqual({
            ok: false,
            error: NotebookValidationError.UnknownConnector,
        });
    });

    it('rejects legacy dataless notebooks', () => {
        expect(validateNotebookData(notebook({ mainDatabase: { databaseId: DATABASE_ID, params: { dataless: {} } as any } }))).toEqual({
            ok: false,
            error: NotebookValidationError.UnknownConnector,
        });
    });

    it('rejects a notebook with an empty notebookId', () => {
        expect(validateNotebookData(notebook({ notebookId: '' }))).toEqual({
            ok: false,
            error: NotebookValidationError.MissingNotebookId,
        });
    });

    it('rejects a notebook whose notebookId is not a valid UUID', () => {
        for (const badId of ['imported-1700000000000', 'opfs://notebooks/' + UUID, 'not-a-uuid', UUID + '-extra']) {
            expect(validateNotebookData(notebook({ notebookId: badId }))).toEqual({
                ok: false,
                error: NotebookValidationError.InvalidNotebookId,
            });
        }
    });

    it('accepts an uppercase UUID', () => {
        expect(validateNotebookData(notebook({ notebookId: UUID.toUpperCase() }))).toEqual({ ok: true });
    });

    it('rejects missing, V1, and unknown format versions', () => {
        for (const formatVersion of [undefined, 1, 3]) {
            expect(validateNotebookData(notebook({ formatVersion } as any))).toEqual({
                ok: false,
                error: NotebookValidationError.UnsupportedFormatVersion,
            });
        }
    });

    it('requires an attached database array', () => {
        const data = notebook();
        delete (data as any).attachedDatabases;
        expect(validateNotebookData(data)).toEqual({
            ok: false,
            error: NotebookValidationError.InvalidAttachedDatabases,
        });
        expect(validateNotebookData(notebook({ attachedDatabases: [] } as any))).toEqual({ ok: true });
    });

    it('accepts multiple attached databases with unique ids', () => {
        expect(validateNotebookData(notebook({ attachedDatabases: [
            { databaseId: REMOTE_DATABASE_ID, params: { trino: {} } as any },
            { databaseId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', params: { salesforce: {} } as any },
        ] }))).toEqual({ ok: true });
    });

    it('rejects an attached database with an invalid databaseId', () => {
        expect(validateNotebookData(notebook({ attachedDatabases: [{ databaseId: 'not-a-uuid', params: { hyper: {} } as any }] }))).toEqual({
            ok: false,
            error: NotebookValidationError.InvalidDatabaseId,
        });
    });

    it('requires a valid main database', () => {
        for (const databaseId of ['', 'not-a-uuid']) {
            expect(validateNotebookData(notebook({ mainDatabase: { databaseId, params: { hyper: {} } as any } }))).toEqual({
                ok: false,
                error: NotebookValidationError.InvalidDatabaseId,
            });
        }
    });

    it('rejects an attached database with missing or unknown params', () => {
        expect(validateNotebookData(notebook({ mainDatabase: { databaseId: DATABASE_ID } as any }))).toEqual({
            ok: false,
            error: NotebookValidationError.MissingDatabaseParams,
        });
        expect(validateNotebookData(notebook({ mainDatabase: { databaseId: DATABASE_ID, params: { garbage: 'data' } as any } }))).toEqual({
            ok: false,
            error: NotebookValidationError.UnknownConnector,
        });
    });
});

describe('describeNotebookValidationError', () => {
    it('produces a human-readable string for every error', () => {
        for (const e of Object.values(NotebookValidationError)) {
            const msg = describeNotebookValidationError(e);
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(0);
        }
    });

    it('describes an unreadable notebook as missing files', () => {
        expect(describeNotebookValidationError(NotebookValidationError.NotebookUnreadable))
            .toBe('Notebook files missing');
    });
});

describe('describeInvalidNotebook', () => {
    const entry: NotebookEntry = { path: UUID };

    it('keys on the manifest entry path and uses notebook data for title and connector', () => {
        const data = notebook({ name: 'My Notebook' });
        const inv = describeInvalidNotebook(entry, NotebookValidationError.UnknownConnector, data);
        expect(inv.notebookId).toBe(UUID);
        expect(inv.title).toBe('My Notebook');
        expect(inv.connectorType).toBe(ConnectorType.HYPER);
        expect(inv.error).toBe(NotebookValidationError.UnknownConnector);
    });

    it('always uses the manifest entry path as the id, even when notebook data has a different one', () => {
        // The entry path is the authoritative registry/delete key; a mismatched (or malformed)
        // notebookId in the notebook data must not become the key.
        const data = notebook({ notebookId: 'imported-123' });
        const inv = describeInvalidNotebook({ path: UUID }, NotebookValidationError.InvalidNotebookId, data);
        expect(inv.notebookId).toBe(UUID);
    });

    it('falls back to the manifest path for the title when notebook data is absent', () => {
        const inv = describeInvalidNotebook(entry, NotebookValidationError.MissingNotebookId, null);
        expect(inv.notebookId).toBe(UUID);
        expect(inv.title).toBe(UUID);
        expect(inv.connectorType).toBeNull();
    });

    it('has a null connector type when params are unknown', () => {
        const data = notebook({ mainDatabase: { databaseId: DATABASE_ID, params: { garbage: 'data' } as any } });
        const inv = describeInvalidNotebook(entry, NotebookValidationError.UnknownConnector, data);
        expect(inv.connectorType).toBeNull();
    });
});
