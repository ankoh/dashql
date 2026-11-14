import { describe, expect, it } from 'vitest';

import { sanitizeConnectionParamsForSharing } from '../../connections/connection_params.js';
import {
    applyConnectionImportPlan,
    connectionImportQuestions,
    connectionRefsChanged,
    planConnectionImport,
} from './workbook_connection_import.js';
import { testWorkbook } from '../../testing/workbook_test_backend.js';
import type { ConnectionEntry, ConnectionParams } from '../../storage/storage_backend.js';

const KNOWN = 'aaaaaaaa-0000-4000-8000-00000000000a';
const OTHER = 'aaaaaaaa-0000-4000-8000-00000000000b';
const IMPORTED = 'bbbbbbbb-0000-4000-8000-00000000000b';
const FRESH = 'cccccccc-0000-4000-8000-00000000000c';
const EMBEDDED = 'dddddddd-0000-4000-8000-00000000000d';
const trino = (endpoint: string, secret = ''): ConnectionParams => ({
    trino: { endpoint, auth: { authType: 'AUTH_BASIC', basic: { username: 'user', secret } } },
}) as ConnectionParams;

const ENTRIES: ConnectionEntry[] = [
    { id: KNOWN, params: trino('https://trino', 'secret') },
    { id: OTHER, params: trino('https://other', 'secret') },
];

function imported(connectionId: string, params: ConnectionParams) {
    return testWorkbook({
        connections: [{ connectionId, params }],
        scripts: [{ name: 'query.sql', connectionId }],
    });
}

describe('workbook connection import', () => {
    it('links a known connection silently when only secrets differ', () => {
        const workbook = imported(KNOWN, sanitizeConnectionParamsForSharing(trino('https://trino', 'secret'), false));
        const plan = planConnectionImport(workbook, ENTRIES);
        expect(plan.map(item => item.decision)).toEqual([{ kind: 'link', connectionId: KNOWN }]);
        expect(connectionImportQuestions(plan)).toEqual([]);
        // The copy takes the full params of the app's connection
        expect(applyConnectionImportPlan(workbook, plan, new Map(), ENTRIES).workbook.connections).toEqual([{ connectionId: KNOWN, params: ENTRIES[0].params }]);
    });

    it('asks when a regenerated id describes a known connection', () => {
        const workbook = imported(IMPORTED, trino('https://trino'));
        const plan = planConnectionImport(workbook, ENTRIES);
        expect(plan[0].decision).toEqual({ kind: 'ask', candidates: [ENTRIES[0]] });
        const linkedImport = applyConnectionImportPlan(workbook, plan, new Map([[IMPORTED, { kind: 'link', connectionId: KNOWN }]]), ENTRIES);
        expect(linkedImport.connectionIds).toEqual(new Map([[IMPORTED, KNOWN]]));
        const linked = linkedImport.workbook;
        expect(linked.connections.map(connection => connection.connectionId)).toEqual([KNOWN]);
        // The scripts follow their connection
        expect(linked.scripts).toEqual([{ name: 'query.sql', connectionId: KNOWN }]);
        expect(connectionRefsChanged(workbook, linked)).toBe(true);
        const separate = applyConnectionImportPlan(workbook, plan, new Map([[IMPORTED, { kind: 'separate' }]]), ENTRIES).workbook;
        expect(separate.connections).toEqual([{ connectionId: IMPORTED, params: trino('https://trino') }]);
        expect(connectionRefsChanged(workbook, separate)).toBe(false);
    });

    it('asks when a known id comes with other params and never reuses the id for a separate connection', () => {
        const workbook = imported(KNOWN, trino('https://elsewhere'));
        const plan = planConnectionImport(workbook, ENTRIES);
        expect(plan[0].decision).toEqual({ kind: 'ask', candidates: [ENTRIES[0]] });
        const result = applyConnectionImportPlan(workbook, plan, new Map([[KNOWN, { kind: 'separate' }]]), ENTRIES, () => FRESH);
        // The catalogs of the bundle follow the renamed connection
        expect(result.connectionIds).toEqual(new Map([[KNOWN, FRESH]]));
        const separate = result.workbook;
        expect(separate.connections).toEqual([{ connectionId: FRESH, params: trino('https://elsewhere') }]);
        expect(separate.scripts).toEqual([{ name: 'query.sql', connectionId: FRESH }]);
    });

    it('links the embedded database silently, the app holds a single connection to it', () => {
        const embedded: ConnectionEntry = { id: EMBEDDED, params: { hyper: { protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } } as ConnectionParams };
        const workbook = imported(IMPORTED, { hyper: {
            protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
            attachedDatabases: [], metadata: {}, queryParameters: {},
        } } as ConnectionParams);
        const plan = planConnectionImport(workbook, [...ENTRIES, embedded]);
        expect(plan[0].decision).toEqual({ kind: 'link', connectionId: EMBEDDED });
        expect(connectionImportQuestions(plan)).toEqual([]);
        const linked = applyConnectionImportPlan(workbook, plan, new Map(), [...ENTRIES, embedded]).workbook;
        expect(linked.connections).toEqual([{ connectionId: EMBEDDED, params: embedded.params }]);
        expect(linked.scripts).toEqual([{ name: 'query.sql', connectionId: EMBEDDED }]);
        // Other attached databases don't make another embedded database
        const attached = imported(IMPORTED, { hyper: {
            protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
            attachedDatabases: [{ path: 'tpch.hyper', alias: 'tpch' }],
        } } as ConnectionParams);
        expect(planConnectionImport(attached, [embedded])[0].decision).toEqual({ kind: 'link', connectionId: EMBEDDED });
        // Without an embedded database the app registers the imported one
        expect(planConnectionImport(workbook, ENTRIES)[0].decision).toEqual({ kind: 'register' });
        // A local cloud attaches a database of the clouds folder, it is a connection of its own
        const local = imported(IMPORTED, { hyper: {
            protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
            attachedDatabases: [{ path: 'clouds/local.hyper', alias: 'dashql' }],
        } } as ConnectionParams);
        expect(planConnectionImport(local, [embedded])[0].decision).toEqual({ kind: 'register' });
    });

    it('registers unknown connections with their ids', () => {
        const workbook = imported(IMPORTED, trino('https://unknown'));
        const plan = planConnectionImport(workbook, ENTRIES);
        expect(plan[0].decision).toEqual({ kind: 'register' });
        expect(connectionRefsChanged(workbook, applyConnectionImportPlan(workbook, plan, new Map(), ENTRIES).workbook)).toBe(false);
    });

    it('keeps the names of new connections and drops them for existing ones', () => {
        const workbook = testWorkbook({
            connections: [
                { connectionId: IMPORTED, params: trino('https://unknown'), name: 'Theirs' },
                { connectionId: FRESH, params: trino('https://trino'), name: 'Production' },
            ],
            scripts: [
                { name: 'new.sql', connectionId: IMPORTED },
                { name: 'known.sql', connectionId: FRESH },
            ],
        });
        const plan = planConnectionImport(workbook, ENTRIES);
        // The question shows the name the connection had in the exporting app
        expect(connectionImportQuestions(plan).map(item => item.ref.name)).toEqual(['Production']);

        const linked = applyConnectionImportPlan(workbook, plan, new Map([[FRESH, { kind: 'link', connectionId: KNOWN }]]), ENTRIES).workbook;
        expect(linked.connections).toEqual([
            { connectionId: IMPORTED, params: trino('https://unknown'), name: 'Theirs' },
            { connectionId: KNOWN, params: trino('https://trino', 'secret') },
        ]);
        const separate = applyConnectionImportPlan(workbook, plan, new Map([[FRESH, { kind: 'separate' }]]), ENTRIES).workbook;
        expect(separate.connections[1]).toEqual({ connectionId: FRESH, params: trino('https://trino'), name: 'Production' });
    });
});
