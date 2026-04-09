import * as arrow from 'apache-arrow';
import { DuckDB, DuckDBConnection, DuckDBPreparedStatement } from './duckdb_api.js';
import { WebDuckDB } from './duckdb_web_api.js';
import {
    WebDBWorkerRequestType,
    WebDBWorkerResponseType,
    WebDBWorkerRequestVariant,
    WebDBWorkerResponseVariant,
} from './duckdb_worker_request.js';

/**
 * Mock worker for testing without actual WASM
 */
class MockWorker {
    public listeners: ((event: MessageEvent) => void)[] = [];
    public lastMessage: any = null;

    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
        this.listeners.push(listener);
    }

    removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
        this.listeners = this.listeners.filter((l) => l !== listener);
    }

    postMessage(message: any) {
        this.lastMessage = message;
    }

    terminate() {
        this.listeners = [];
    }

    // Helper to simulate receiving a message from worker
    simulateResponse(response: WebDBWorkerResponseVariant) {
        const event = new MessageEvent('message', { data: response });
        this.listeners.forEach((listener) => listener(event));
    }
}

// Helper to convert Arrow Table rows to plain objects
function toPlainObjects(table: arrow.Table): any[] {
    return table.toArray().map(row => {
        const obj: any = {};
        for (const key of Object.keys(row)) {
            obj[key] = row[key];
        }
        return obj;
    });
}

describe('WebDB API (Mock)', () => {
    let mockWorker: MockWorker;
    let webdb: DuckDB;

    beforeEach(() => {
        mockWorker = new MockWorker();
        webdb = new WebDuckDB(mockWorker as any);
    });

    afterEach(() => {
        webdb.terminate();
    });

    it('should send ping request', async () => {
        const promise = webdb.ping();

        expect(mockWorker.lastMessage).toBeDefined();
        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.PING);

        // Simulate OK response
        mockWorker.simulateResponse({
            messageId: 1,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.OK,
            data: null,
        });

        await expect(promise).resolves.toBeUndefined();
    });

    it('should send instantiate request', async () => {
        const promise = webdb.instantiate('/path/to/webdb.wasm');

        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.INSTANTIATE);
        expect(mockWorker.lastMessage.data.wasmUrl).toBe('/path/to/webdb.wasm');

        mockWorker.simulateResponse({
            messageId: 1,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.OK,
            data: null,
        });

        await expect(promise).resolves.toBeUndefined();
    });

    it('should send open request with options', async () => {
        const options = {
            maximumThreads: 4,
            query: {
                castBigIntToDouble: true,
            },
        };

        const promise = webdb.open(options);

        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.OPEN);
        expect(mockWorker.lastMessage.data).toEqual(options);

        mockWorker.simulateResponse({
            messageId: 1,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.OK,
            data: null,
        });

        await expect(promise).resolves.toBeUndefined();
    });

    it('should get version', async () => {
        const promise = webdb.getVersion();

        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.GET_VERSION);

        mockWorker.simulateResponse({
            messageId: 1,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.VERSION,
            data: { version: 'v1.2.3' },
        });

        await expect(promise).resolves.toBe('v1.2.3');
    });

    it('should create connection', async () => {
        const promise = webdb.connect();

        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.CONNECT);

        mockWorker.simulateResponse({
            messageId: 1,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.CONNECTION_ID,
            data: { connectionId: 42 },
        });

        const conn = await promise;
        expect(conn).toBeInstanceOf(DuckDBConnection);
    });

    it('should handle worker errors', async () => {
        const promise = webdb.ping();

        mockWorker.simulateResponse({
            messageId: 1,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.ERROR,
            data: {
                name: 'Error',
                message: 'Worker failed',
                stack: 'Error: Worker failed\n  at ...',
            },
        });

        await expect(promise).rejects.toThrow('Worker failed');
    });

    it('should reset database', async () => {
        const promise = webdb.reset();

        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.RESET);

        mockWorker.simulateResponse({
            messageId: 1,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.OK,
            data: null,
        });

        await expect(promise).resolves.toBeUndefined();
    });
});

describe('WebDBConnection (Mock)', () => {
    let mockWorker: MockWorker;
    let webdb: DuckDB;
    let conn: DuckDBConnection;

    beforeEach(async () => {
        mockWorker = new MockWorker();
        webdb = new WebDuckDB(mockWorker as any);

        const connectPromise = webdb.connect();
        mockWorker.simulateResponse({
            messageId: 1,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.CONNECTION_ID,
            data: { connectionId: 1 },
        });

        conn = await connectPromise;
    });

    afterEach(() => {
        // Just terminate without waiting for close - this is a mock test
        webdb.terminate();
    });

    it('should send query request', async () => {
        const queryPromise = conn.query('SELECT 42');

        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.QUERY_RUN);
        expect(mockWorker.lastMessage.data.connectionId).toBe(1);
        expect(mockWorker.lastMessage.data.query).toBe('SELECT 42');

        // Create a simple Arrow IPC buffer
        const table = arrow.tableFromArrays({
            answer: new Int32Array([42]),
        });
        const buffer = arrow.tableToIPC(table, 'stream');

        mockWorker.simulateResponse({
            messageId: 2,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.ARROW_BUFFER,
            data: { buffer },
        });

        const result = await queryPromise;
        expect(result.numRows).toBe(1);
        expect(toPlainObjects(result)).toEqual([{ answer: 42 }]);
    });

    it('should send insert arrow request', async () => {
        const table = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3]),
            name: ['a', 'b', 'c'],
        });

        const insertPromise = conn.insertArrowTable(table, {
            name: 'test_table',
            create: true,
        });

        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.INSERT_ARROW_IPC);
        expect(mockWorker.lastMessage.data.connectionId).toBe(1);
        expect(mockWorker.lastMessage.data.options.name).toBe('test_table');
        expect(mockWorker.lastMessage.data.options.create).toBe(true);
        expect(mockWorker.lastMessage.data.buffer).toBeInstanceOf(Uint8Array);

        mockWorker.simulateResponse({
            messageId: 2,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.OK,
            data: null,
        });

        await expect(insertPromise).resolves.toBeUndefined();
    });

    it('should throw error when closed', async () => {
        const closePromise = conn.close();

        mockWorker.simulateResponse({
            messageId: 2,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.OK,
            data: null,
        });

        await closePromise;

        await expect(conn.query('SELECT 1')).rejects.toThrow('Connection is closed');
    });

    it('should prepare statement', async () => {
        const preparePromise = conn.prepare('SELECT $1 + $2');

        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.PREPARED_CREATE);
        expect(mockWorker.lastMessage.data.query).toBe('SELECT $1 + $2');

        mockWorker.simulateResponse({
            messageId: 2,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.PREPARED_STATEMENT_ID,
            data: { statementId: 10 },
        });

        const stmt = await preparePromise;
        expect(stmt).toBeInstanceOf(DuckDBPreparedStatement);
    });
});

describe('WebDBPreparedStatement (Mock)', () => {
    let mockWorker: MockWorker;
    let webdb: DuckDB;
    let conn: DuckDBConnection;
    let stmt: DuckDBPreparedStatement;

    beforeEach(async () => {
        mockWorker = new MockWorker();
        webdb = new WebDuckDB(mockWorker as any);

        // Connect
        const connectPromise = webdb.connect();
        mockWorker.simulateResponse({
            messageId: 1,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.CONNECTION_ID,
            data: { connectionId: 1 },
        });
        conn = await connectPromise;

        // Prepare statement
        const preparePromise = conn.prepare('SELECT $1 + $2');
        mockWorker.simulateResponse({
            messageId: 2,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.PREPARED_STATEMENT_ID,
            data: { statementId: 10 },
        });
        stmt = await preparePromise;
    });

    afterEach(() => {
        // Just terminate without waiting for close - this is a mock test
        webdb.terminate();
    });

    it('should run prepared statement', async () => {
        const runPromise = stmt.run([5, 10]);

        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.PREPARED_RUN);
        expect(mockWorker.lastMessage.data.statementId).toBe(10);
        expect(mockWorker.lastMessage.data.params).toEqual([5, 10]);

        const table = arrow.tableFromArrays({
            result: new Int32Array([15]),
        });
        const buffer = arrow.tableToIPC(table, 'stream');

        mockWorker.simulateResponse({
            messageId: 3,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.ARROW_BUFFER,
            data: { buffer },
        });

        const result = await runPromise;
        expect(toPlainObjects(result)).toEqual([{ result: 15 }]);
    });

    it('should close prepared statement', async () => {
        const closePromise = stmt.close();

        expect(mockWorker.lastMessage.type).toBe(WebDBWorkerRequestType.PREPARED_CLOSE);
        expect(mockWorker.lastMessage.data.statementId).toBe(10);

        mockWorker.simulateResponse({
            messageId: 3,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.OK,
            data: null,
        });

        await expect(closePromise).resolves.toBeUndefined();
    });

    it('should throw error when closed', async () => {
        const closePromise = stmt.close();
        mockWorker.simulateResponse({
            messageId: 3,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.OK,
            data: null,
        });

        await closePromise;

        await expect(stmt.run([1, 2])).rejects.toThrow('Prepared statement is closed');
    });
});

describe('WebDB Error Handling', () => {
    let mockWorker: MockWorker;
    let webdb: DuckDB;

    beforeEach(() => {
        mockWorker = new MockWorker();
        webdb = new WebDuckDB(mockWorker as any);
    });

    afterEach(() => {
        webdb.terminate();
    });

    it('should handle errors with stack traces', async () => {
        const promise = webdb.getVersion();

        mockWorker.simulateResponse({
            messageId: 1,
            requestId: mockWorker.lastMessage.messageId,
            type: WebDBWorkerResponseType.ERROR,
            data: {
                name: 'CustomError',
                message: 'Something went wrong',
                stack: 'CustomError: Something went wrong\n  at func1\n  at func2',
            },
        });

        await expect(promise).rejects.toThrow('Something went wrong');

        try {
            await promise;
        } catch (e: any) {
            expect(e.name).toBe('CustomError');
            expect(e.message).toBe('Something went wrong');
            expect(e.stack).toContain('func1');
        }
    });

    it('should handle multiple pending requests', async () => {
        const promise1 = webdb.ping();
        const promise2 = webdb.getVersion();

        const msg1 = mockWorker.lastMessage;

        // Respond to second request first
        mockWorker.simulateResponse({
            messageId: 2,
            requestId: 1,
            type: WebDBWorkerResponseType.VERSION,
            data: { version: 'v1.0.0' },
        });

        // Then respond to first request
        mockWorker.simulateResponse({
            messageId: 3,
            requestId: 0,
            type: WebDBWorkerResponseType.OK,
            data: null,
        });

        await expect(promise1).resolves.toBeUndefined();
        await expect(promise2).resolves.toBe('v1.0.0');
    });
});
