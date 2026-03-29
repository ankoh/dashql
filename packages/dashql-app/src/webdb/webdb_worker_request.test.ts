import {
    WebDBWorkerRequestType,
    WebDBWorkerResponseType,
    WebDBWorkerTask,
    WebDBOpenOptions,
    WebDBInsertOptions,
} from './webdb_worker_request.js';

describe('WebDBWorkerTask', () => {
    it('should create a task with promise', () => {
        const task = new WebDBWorkerTask(WebDBWorkerRequestType.PING, null);

        expect(task.type).toBe(WebDBWorkerRequestType.PING);
        expect(task.data).toBeNull();
        expect(task.promise).toBeInstanceOf(Promise);
        expect(typeof task.promiseResolver).toBe('function');
        expect(typeof task.promiseRejecter).toBe('function');
    });

    it('should resolve promise when promiseResolver is called', async () => {
        const task = new WebDBWorkerTask(WebDBWorkerRequestType.GET_VERSION, null);

        setTimeout(() => {
            task.promiseResolver({ version: 'v1.2.3' });
        }, 10);

        const result = await task.promise;
        expect(result).toEqual({ version: 'v1.2.3' });
    });

    it('should reject promise when promiseRejecter is called', async () => {
        const task = new WebDBWorkerTask(WebDBWorkerRequestType.QUERY_RUN, {
            connectionId: 1,
            query: 'SELECT * FROM test',
        });

        setTimeout(() => {
            task.promiseRejecter(new Error('Query failed'));
        }, 10);

        await expect(task.promise).rejects.toThrow('Query failed');
    });
});

describe('WebDBWorkerRequestType', () => {
    it('should have all required request types', () => {
        expect(WebDBWorkerRequestType.PING).toBe('PING');
        expect(WebDBWorkerRequestType.INSTANTIATE).toBe('INSTANTIATE');
        expect(WebDBWorkerRequestType.OPEN).toBe('OPEN');
        expect(WebDBWorkerRequestType.RESET).toBe('RESET');
        expect(WebDBWorkerRequestType.GET_VERSION).toBe('GET_VERSION');
        expect(WebDBWorkerRequestType.CONNECT).toBe('CONNECT');
        expect(WebDBWorkerRequestType.DISCONNECT).toBe('DISCONNECT');
        expect(WebDBWorkerRequestType.QUERY_RUN).toBe('QUERY_RUN');
        expect(WebDBWorkerRequestType.PREPARED_CREATE).toBe('PREPARED_CREATE');
        expect(WebDBWorkerRequestType.INSERT_ARROW_IPC).toBe('INSERT_ARROW_IPC');
    });
});

describe('WebDBWorkerResponseType', () => {
    it('should have all required response types', () => {
        expect(WebDBWorkerResponseType.OK).toBe('OK');
        expect(WebDBWorkerResponseType.ERROR).toBe('ERROR');
        expect(WebDBWorkerResponseType.VERSION).toBe('VERSION');
        expect(WebDBWorkerResponseType.CONNECTION_ID).toBe('CONNECTION_ID');
        expect(WebDBWorkerResponseType.ARROW_BUFFER).toBe('ARROW_BUFFER');
        expect(WebDBWorkerResponseType.PREPARED_STATEMENT_ID).toBe('PREPARED_STATEMENT_ID');
    });
});

describe('WebDBOpenOptions', () => {
    it('should accept valid open options', () => {
        const options: WebDBOpenOptions = {
            path: ':memory:',
            maximumThreads: 4,
            query: {
                castBigIntToDouble: true,
                castTimestampToDate: false,
                castDurationToTime64: true,
            },
        };

        expect(options.path).toBe(':memory:');
        expect(options.maximumThreads).toBe(4);
        expect(options.query?.castBigIntToDouble).toBe(true);
    });

    it('should work with minimal options', () => {
        const options: WebDBOpenOptions = {};

        expect(options).toEqual({});
    });
});

describe('WebDBInsertOptions', () => {
    it('should accept valid insert options', () => {
        const options: WebDBInsertOptions = {
            schema: 'main',
            name: 'users',
            create: true,
        };

        expect(options.schema).toBe('main');
        expect(options.name).toBe('users');
        expect(options.create).toBe(true);
    });

    it('should work with minimal options', () => {
        const options: WebDBInsertOptions = {
            name: 'test_table',
        };

        expect(options.name).toBe('test_table');
        expect(options.schema).toBeUndefined();
        expect(options.create).toBeUndefined();
    });
});

describe('Request/Response Type Safety', () => {
    it('should create type-safe request objects', () => {
        const pingRequest = {
            messageId: 1,
            type: WebDBWorkerRequestType.PING as const,
            data: null,
        };

        const connectRequest = {
            messageId: 2,
            type: WebDBWorkerRequestType.CONNECT as const,
            data: null,
        };

        const queryRequest = {
            messageId: 3,
            type: WebDBWorkerRequestType.QUERY_RUN as const,
            data: {
                connectionId: 1,
                query: 'SELECT 1',
            },
        };

        expect(pingRequest.type).toBe('PING');
        expect(connectRequest.type).toBe('CONNECT');
        expect(queryRequest.type).toBe('QUERY_RUN');
        expect(queryRequest.data.query).toBe('SELECT 1');
    });

    it('should create type-safe response objects', () => {
        const okResponse = {
            messageId: 1,
            requestId: 1,
            type: WebDBWorkerResponseType.OK as const,
            data: null,
        };

        const versionResponse = {
            messageId: 2,
            requestId: 2,
            type: WebDBWorkerResponseType.VERSION as const,
            data: { version: 'v1.0.0' },
        };

        const connectionResponse = {
            messageId: 3,
            requestId: 3,
            type: WebDBWorkerResponseType.CONNECTION_ID as const,
            data: { connectionId: 123 },
        };

        expect(okResponse.type).toBe('OK');
        expect(versionResponse.data.version).toBe('v1.0.0');
        expect(connectionResponse.data.connectionId).toBe(123);
    });
});
