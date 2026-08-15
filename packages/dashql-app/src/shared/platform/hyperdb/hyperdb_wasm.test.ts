// @vitest-environment node
import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import {
    HyperDB,
    type HyperDBEngineClient,
    type HyperDBResult,
} from './hyperdb_wasm.js';

function handle(value: number): HyperDBResult {
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, value, true);
    return { state: 'ok', payload };
}

function ipc(table: arrow.Table): Uint8Array {
    return arrow.tableToIPC(table, 'stream');
}

class FakeHyperDBEngineClient implements HyperDBEngineClient {
    readonly calls: string[] = [];
    readonly queryResults = new Map<string, Uint8Array>();
    readonly temporaryFiles = new Map<string, Uint8Array>();
    readonly insertedTables = new Map<string, arrow.Table>();

    connectCount = 0;
    disconnectCount = 0;
    terminateCount = 0;
    activeOperationCount = 0;
    maximumActiveOperationCount = 0;
    failStartQuery = false;

    private nextQuery = 10;
    private nextFile = 1;
    private readonly queries = new Map<number, HyperDBResult[]>();

    ready(): Promise<void> {
        this.calls.push('ready');
        return Promise.resolve();
    }

    connect(): Promise<HyperDBResult> {
        this.calls.push('connect');
        this.connectCount++;
        return Promise.resolve(handle(7));
    }

    disconnect(connection: number): Promise<HyperDBResult> {
        this.calls.push(`disconnect:${connection}`);
        this.disconnectCount++;
        return Promise.resolve({ state: 'ok', payload: new Uint8Array() });
    }

    startQuery(connection: number, sql: string): Promise<HyperDBResult> {
        if (this.failStartQuery) {
            return Promise.resolve({ state: 'busy', error: 'start failed' });
        }
        this.beginOperation();
        this.calls.push(`query:${connection}:${sql}`);
        const query = this.nextQuery++;
        const result = this.queryResults.get(sql);
        this.queries.set(query, result
            ? [{ state: 'chunk', payload: result }, { state: 'done' }]
            : [{ state: 'error', error: `unexpected query: ${sql}` }]);
        return Promise.resolve(handle(query));
    }

    insertArrowIPCFromPath(
        connection: number,
        path: string,
        name: string,
        schema: string | null,
        create: boolean,
        internal: boolean,
    ): Promise<HyperDBResult> {
        this.beginOperation();
        this.calls.push(`insert:${connection}:${path}:${schema ?? ''}:${name}:${create}:${internal}`);
        const query = this.nextQuery++;
        const bytes = this.temporaryFiles.get(path);
        if (!bytes) {
            this.queries.set(query, [{ state: 'error', error: `missing temporary file: ${path}` }]);
        } else {
            const table = arrow.tableFromIPC(bytes);
            const key = schema ? `${schema}.${name}` : name;
            if (create) {
                this.insertedTables.set(key, table);
            } else {
                const previous = this.insertedTables.get(key);
                if (!previous) {
                    this.queries.set(query, [{ state: 'error', error: `missing table: ${key}` }]);
                    return Promise.resolve(handle(query));
                }
                this.insertedTables.set(key, previous.concat(table));
            }
            this.queries.set(query, [{ state: 'done' }]);
        }
        return Promise.resolve(handle(query));
    }

    createTemporaryFile(bytes: Uint8Array): Promise<HyperDBResult> {
        const path = `/tmp/hyperdb/test-${this.nextFile++}.arrows`;
        this.calls.push(`create-file:${path}`);
        this.temporaryFiles.set(path, bytes.slice());
        return Promise.resolve({ state: 'ok', payload: new TextEncoder().encode(path) });
    }

    removeFile(path: string): Promise<HyperDBResult> {
        this.calls.push(`remove-file:${path}`);
        this.temporaryFiles.delete(path);
        return Promise.resolve({ state: 'ok', payload: new Uint8Array() });
    }

    pollQuery(query: number): Promise<HyperDBResult> {
        this.calls.push(`poll:${query}`);
        const results = this.queries.get(query);
        return Promise.resolve(results?.shift() ?? { state: 'error', error: `missing query: ${query}` });
    }

    cancelQuery(query: number): Promise<HyperDBResult> {
        this.calls.push(`cancel:${query}`);
        return Promise.resolve({ state: 'ok', payload: new Uint8Array() });
    }

    releaseQuery(query: number): Promise<HyperDBResult> {
        this.calls.push(`release:${query}`);
        this.queries.delete(query);
        this.activeOperationCount--;
        return Promise.resolve({ state: 'ok', payload: new Uint8Array() });
    }

    terminate(): Promise<void> {
        this.calls.push('terminate');
        this.terminateCount++;
        return Promise.resolve();
    }

    private beginOperation(): void {
        this.activeOperationCount++;
        this.maximumActiveOperationCount = Math.max(this.maximumActiveOperationCount, this.activeOperationCount);
    }
}

function toPlainObjects(table: arrow.Table): Record<string, unknown>[] {
    return table.toArray().map(row => Object.fromEntries(Object.keys(row).map(key => [key, row[key]])));
}

describe('HyperDB embedded database adapter', () => {
    it('keeps one physical session alive across logical connection leases', async () => {
        const client = new FakeHyperDBEngineClient();
        const database = await HyperDB.create(client);
        const first = await database.connect();
        const second = await database.connect();

        await first.close();
        const third = await database.connect();

        expect(client.connectCount).toBe(1);
        expect(client.disconnectCount).toBe(0);

        await second.close();
        await third.close();
        await database.terminate();

        expect(client.disconnectCount).toBe(1);
        expect(client.terminateCount).toBe(1);
    });

    it('makes a temporary Arrow table available to later logical connections', async () => {
        const client = new FakeHyperDBEngineClient();
        const database = await HyperDB.create(client);
        const writer = await database.connect();

        await writer.insertArrowTable(arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3]),
            label: ['alpha', 'beta', 'gamma'],
        }), { name: '__frame', create: true });
        await writer.close();

        const inserted = client.insertedTables.get('__frame');
        expect(inserted).toBeDefined();
        client.queryResults.set('SELECT * FROM "__frame"', ipc(inserted!));

        const reader = await database.connect();
        const result = await reader.query('SELECT * FROM "__frame"');

        expect(toPlainObjects(result)).toEqual([
            { id: 1, label: 'alpha' },
            { id: 2, label: 'beta' },
            { id: 3, label: 'gamma' },
        ]);
        expect(client.calls).toContain('insert:7:/tmp/hyperdb/test-1.arrows::__frame:true:true');
        expect(client.connectCount).toBe(1);

        await reader.close();
        await database.terminate();
    });

    it('uses Arrow IPC from DashQL Arrow and materializes dictionary columns', async () => {
        const client = new FakeHyperDBEngineClient();
        const database = await HyperDB.create(client);
        const connection = await database.connect();

        await connection.insertArrowTable(arrow.tableFromArrays({ label: ['first', 'second'] }), {
            name: 'labels',
            create: true,
        });

        const inserted = client.insertedTables.get('labels');
        expect(inserted?.schema.fields[0]?.type.toString()).toBe('Utf8');
        expect(client.temporaryFiles.size).toBe(0);

        await connection.close();
        await database.terminate();
    });

    it('preserves schema and append options while cleaning up staged IPC', async () => {
        const client = new FakeHyperDBEngineClient();
        const database = await HyperDB.create(client);
        const connection = await database.connect();

        await connection.insertArrowTable(arrow.tableFromArrays({ value: new Int32Array([1]) }), {
            schema: 'pg_temp',
            name: 'values',
        });
        await connection.insertArrowTable(arrow.tableFromArrays({ value: new Int32Array([2]) }), {
            schema: 'pg_temp',
            name: 'values',
            create: false,
        });

        expect(toPlainObjects(client.insertedTables.get('pg_temp.values')!)).toEqual([
            { value: 1 },
            { value: 2 },
        ]);
        expect(client.calls).toContain('insert:7:/tmp/hyperdb/test-1.arrows:pg_temp:values:true:true');
        expect(client.calls).toContain('insert:7:/tmp/hyperdb/test-2.arrows:pg_temp:values:false:true');
        expect(client.temporaryFiles.size).toBe(0);

        await connection.close();
        await database.terminate();
    });

    it('creates derived relations as temporary tables with quoted names', async () => {
        const client = new FakeHyperDBEngineClient();
        const database = await HyperDB.create(client);
        const connection = await database.connect();
        client.queryResults.set(
            'CREATE TEMPORARY TABLE "derived""rows" AS SELECT 1',
            ipc(arrow.tableFromArrays({})),
        );

        await connection.createTableAs('derived"rows', 'SELECT 1');

        expect(client.calls).toContain('query:7:CREATE TEMPORARY TABLE "derived""rows" AS SELECT 1');
        await connection.close();
        await database.terminate();
    });

    it('serializes operations submitted through separate logical connections', async () => {
        const client = new FakeHyperDBEngineClient();
        const firstResult = ipc(arrow.tableFromArrays({ value: new Int32Array([1]) }));
        const secondResult = ipc(arrow.tableFromArrays({ value: new Int32Array([2]) }));
        client.queryResults.set('SELECT 1 AS value', firstResult);
        client.queryResults.set('SELECT 2 AS value', secondResult);
        const database = await HyperDB.create(client);
        const first = await database.connect();
        const second = await database.connect();

        const [one, two] = await Promise.all([
            first.query('SELECT 1 AS value'),
            second.query('SELECT 2 AS value'),
        ]);

        expect(toPlainObjects(one)).toEqual([{ value: 1 }]);
        expect(toPlainObjects(two)).toEqual([{ value: 2 }]);
        expect(client.maximumActiveOperationCount).toBe(1);

        await first.close();
        await second.close();
        await database.terminate();
    });

    it('releases failed queries and leaves the shared session usable', async () => {
        const client = new FakeHyperDBEngineClient();
        client.queryResults.set('SELECT 42 AS answer', ipc(arrow.tableFromArrays({ answer: new Int32Array([42]) })));
        const database = await HyperDB.create(client);
        const first = await database.connect();
        const second = await database.connect();

        await expect(first.query('SELECT missing')).rejects.toThrow('unexpected query: SELECT missing');
        await expect(second.query('SELECT 42 AS answer')).resolves.toBeDefined();

        expect(client.activeOperationCount).toBe(0);
        expect(client.calls.filter(call => call.startsWith('release:'))).toHaveLength(2);

        await first.close();
        await second.close();
        await database.terminate();
    });

    it('releases the operation lock when starting a query fails', async () => {
        const client = new FakeHyperDBEngineClient();
        client.failStartQuery = true;
        const database = await HyperDB.create(client);
        const first = await database.connect();
        const second = await database.connect();

        await expect(first.query('SELECT 1')).rejects.toThrow('start failed');

        client.failStartQuery = false;
        client.queryResults.set('SELECT 2 AS value', ipc(arrow.tableFromArrays({ value: new Int32Array([2]) })));
        await expect(second.query('SELECT 2 AS value')).resolves.toBeDefined();

        await first.close();
        await second.close();
        await database.terminate();
    });

    it('rejects use of a closed logical connection without closing the physical session', async () => {
        const client = new FakeHyperDBEngineClient();
        const database = await HyperDB.create(client);
        const connection = await database.connect();
        await connection.close();

        await expect(connection.query('SELECT 1')).rejects.toThrow('connection is closed');
        expect(client.disconnectCount).toBe(0);

        await database.terminate();
    });
});
