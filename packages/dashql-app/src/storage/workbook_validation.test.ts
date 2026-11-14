import { describe, it, expect } from 'vitest';
import {
    validateWorkbookData,
    describeInvalidWorkbook,
    describeWorkbookValidationError,
    WorkbookValidationError,
} from '@ankoh/dashql-sdk/storage/workbook_validation';
import type { WorkbookData, WorkbookEntry } from '@ankoh/dashql-sdk/storage/storage_backend';
import { ConnectorType } from '@ankoh/dashql-sdk/connections/connector_info';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CONNECTION_ID = '11111111-2222-3333-4444-555555555555';
const REMOTE_CONNECTION_ID = '66666666-7777-8888-9999-aaaaaaaaaaaa';

function workbook(extra: Partial<WorkbookData> = {}): WorkbookData {
    return {
        formatVersion: 11,
        workbookId: UUID,
        connections: [{ connectionId: CONNECTION_ID, params: { hyper: {} } as any }],
        scripts: [],
        attachments: [],
        metadata: {},
        ...extra,
    } as WorkbookData;
}

/// A workbook with a single connection
function withDefault(connection: Record<string, unknown>): WorkbookData {
    return workbook({ connections: [connection as any] });
}

describe('validateWorkbookData', () => {
    it('accepts a well-formed Hyper session', () => {
        expect(validateWorkbookData(workbook())).toEqual({ ok: true });
    });

    it('accepts each known remote connector after the local database', () => {
        const local = { connectionId: CONNECTION_ID, params: { hyper: { protocol: 'WASM' } } as any };
        const remote = (params: any) => workbook({
            connections: [{ connectionId: REMOTE_CONNECTION_ID, params }, local],
        });
        const hyper = remote({ hyper: { protocol: 'V3_HTTP' } });
        const sf = remote({ salesforce: {} });
        const trino = remote({ trino: {} });
        expect(validateWorkbookData(hyper).ok).toBe(true);
        expect(validateWorkbookData(sf).ok).toBe(true);
        expect(validateWorkbookData(trino).ok).toBe(true);
    });

    it('rejects removed connector metadata', () => {
        expect(validateWorkbookData(withDefault({ connectionId: CONNECTION_ID, params: { duckdb: {} } }))).toEqual({
            ok: false,
            error: WorkbookValidationError.UnknownConnector,
        });
    });

    it('rejects legacy dataless workbooks', () => {
        expect(validateWorkbookData(withDefault({ connectionId: CONNECTION_ID, params: { dataless: {} } }))).toEqual({
            ok: false,
            error: WorkbookValidationError.UnknownConnector,
        });
    });

    it('rejects a workbook with an empty workbookId', () => {
        expect(validateWorkbookData(workbook({ workbookId: '' }))).toEqual({
            ok: false,
            error: WorkbookValidationError.MissingWorkbookId,
        });
    });

    it('rejects a workbook whose workbookId is not a valid UUID', () => {
        for (const badId of ['imported-1700000000000', 'opfs://workbooks/' + UUID, 'not-a-uuid', UUID + '-extra']) {
            expect(validateWorkbookData(workbook({ workbookId: badId }))).toEqual({
                ok: false,
                error: WorkbookValidationError.InvalidWorkbookId,
            });
        }
    });

    it('accepts an uppercase UUID', () => {
        expect(validateWorkbookData(workbook({ workbookId: UUID.toUpperCase() }))).toEqual({ ok: true });
    });

    it('rejects missing, older, and unknown format versions', () => {
        for (const formatVersion of [undefined, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) {
            expect(validateWorkbookData(workbook({ formatVersion } as any))).toEqual({
                ok: false,
                error: WorkbookValidationError.UnsupportedFormatVersion,
            });
        }
    });

    it('requires a non-empty connection list', () => {
        const data = workbook();
        delete (data as any).connections;
        expect(validateWorkbookData(data)).toEqual({
            ok: false,
            error: WorkbookValidationError.InvalidConnections,
        });
        expect(validateWorkbookData(workbook({ connections: [] }))).toEqual({
            ok: false,
            error: WorkbookValidationError.InvalidConnections,
        });
    });

    it('accepts multiple connections with unique ids', () => {
        expect(validateWorkbookData(workbook({ connections: [
            { connectionId: CONNECTION_ID, params: { hyper: {} } as any },
            { connectionId: REMOTE_CONNECTION_ID, params: { trino: {} } as any },
            { connectionId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', params: { salesforce: {} } as any },
        ] }))).toEqual({ ok: true });
    });

    it('rejects invalid and duplicate connection ids', () => {
        for (const connectionId of ['', 'not-a-uuid']) {
            expect(validateWorkbookData(workbook({ connections: [
                { connectionId: CONNECTION_ID, params: { hyper: {} } as any },
                { connectionId, params: { hyper: {} } as any },
            ] }))).toEqual({ ok: false, error: WorkbookValidationError.InvalidConnectionId });
        }
        expect(validateWorkbookData(workbook({ connections: [
            { connectionId: CONNECTION_ID, params: { hyper: {} } as any },
            { connectionId: CONNECTION_ID, params: { trino: {} } as any },
        ] }))).toEqual({ ok: false, error: WorkbookValidationError.InvalidConnectionId });
    });

    it('rejects a connection with missing or unknown params', () => {
        expect(validateWorkbookData(withDefault({ connectionId: CONNECTION_ID }))).toEqual({
            ok: false,
            error: WorkbookValidationError.MissingConnectionParams,
        });
        expect(validateWorkbookData(withDefault({ connectionId: CONNECTION_ID, params: { garbage: 'data' } }))).toEqual({
            ok: false,
            error: WorkbookValidationError.UnknownConnector,
        });
    });
});

describe('describeWorkbookValidationError', () => {
    it('produces a human-readable string for every error', () => {
        for (const e of Object.values(WorkbookValidationError)) {
            const msg = describeWorkbookValidationError(e);
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(0);
        }
    });

    it('describes an unreadable workbook as missing files', () => {
        expect(describeWorkbookValidationError(WorkbookValidationError.WorkbookUnreadable))
            .toBe('Workbook files missing');
    });
});

describe('describeInvalidWorkbook', () => {
    const entry: WorkbookEntry = { path: UUID };

    it('keys on the manifest entry path and uses workbook data for title and connector', () => {
        const data = workbook({ name: 'My Workbook' });
        const inv = describeInvalidWorkbook(entry, WorkbookValidationError.UnknownConnector, data);
        expect(inv.workbookId).toBe(UUID);
        expect(inv.title).toBe('My Workbook');
        expect(inv.connectorType).toBe(ConnectorType.HYPER);
        expect(inv.error).toBe(WorkbookValidationError.UnknownConnector);
    });

    it('always uses the manifest entry path as the id, even when workbook data has a different one', () => {
        // The entry path is the authoritative registry/delete key; a mismatched (or malformed)
        // workbookId in the workbook data must not become the key.
        const data = workbook({ workbookId: 'imported-123' });
        const inv = describeInvalidWorkbook({ path: UUID }, WorkbookValidationError.InvalidWorkbookId, data);
        expect(inv.workbookId).toBe(UUID);
    });

    it('falls back to the manifest path for the title when workbook data is absent', () => {
        const inv = describeInvalidWorkbook(entry, WorkbookValidationError.MissingWorkbookId, null);
        expect(inv.workbookId).toBe(UUID);
        expect(inv.title).toBe(UUID);
        expect(inv.connectorType).toBeNull();
    });

    it('has a null connector type when params are unknown', () => {
        const data = withDefault({ connectionId: CONNECTION_ID, params: { garbage: 'data' } });
        const inv = describeInvalidWorkbook(entry, WorkbookValidationError.UnknownConnector, data);
        expect(inv.connectorType).toBeNull();
    });
});
