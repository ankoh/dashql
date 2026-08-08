import { describe, it, expect } from 'vitest';
import {
    validateNotebookData,
    describeInvalidNotebook,
    describeNotebookValidationError,
    NotebookValidationError,
} from './notebook_validation.js';
import type { NotebookData, NotebookEntry } from './storage_backend.js';
import { ConnectorType } from '../../connection/connector_info.js';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function notebook(extra: Partial<NotebookData> = {}): NotebookData {
    return {
        notebookId: UUID,
        connectionParams: { dataless: {} },
        metadata: {},
        ...extra,
    } as NotebookData;
}

describe('validateNotebookData', () => {
    it('accepts a well-formed dataless notebook', () => {
        expect(validateNotebookData(notebook())).toEqual({ ok: true });
    });

    it('accepts each known connector', () => {
        const hyper = notebook({ connectionParams: { hyper: {} } as any });
        const sf = notebook({ connectionParams: { salesforce: {} } as any });
        const trino = notebook({ connectionParams: { trino: {} } as any });
        expect(validateNotebookData(hyper).ok).toBe(true);
        expect(validateNotebookData(sf).ok).toBe(true);
        expect(validateNotebookData(trino).ok).toBe(true);
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

    it('rejects a notebook with no connectionParams', () => {
        const data = notebook();
        delete (data as any).connectionParams;
        expect(validateNotebookData(data)).toEqual({
            ok: false,
            error: NotebookValidationError.MissingConnectionParams,
        });
    });

    it('rejects a notebook whose connectionParams match no known connector', () => {
        expect(validateNotebookData(notebook({ connectionParams: { garbage: 'data' } as any }))).toEqual({
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
        const data = notebook({ name: 'My Notebook', connectionParams: { hyper: {} } as any });
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
        const data = notebook({ connectionParams: { garbage: 'data' } as any });
        const inv = describeInvalidNotebook(entry, NotebookValidationError.UnknownConnector, data);
        expect(inv.connectorType).toBeNull();
    });
});
