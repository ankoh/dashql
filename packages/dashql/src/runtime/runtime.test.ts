import * as dashql from '../core/index.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createRuntime, type Runtime, type RuntimeOptions } from './runtime.js';
import { TASK_UPDATE_SCHEDULER } from './store/update_scheduler.js';
import { TestLogger } from '../platform/testing/test_logger.js';
import { WorkbookTestBackend } from '../platform/testing/workbook_test_backend.js';
import { newDefaultHyperWasmConnection } from '../platform/connections/connection_params.js';
import type { OAuthFlow } from '../platform/oauth_flow.js';
import type { HttpClient } from '../platform/http_client.js';
import { ConnectorType } from '../platform/connections/connector_info.js';
import type { TrinoConnectionParams } from '@akohn/dashql-jsonschema/connection.js';
import type { WorkbookData } from '../platform/storage/storage_backend.js';
import type { EmbeddedComputeDatabase } from '../platform/embedded_database.js';
import { tableFromArrays } from '../platform/testing/arrow_fixtures.js';
import { TestClock } from '../core/testing/test_clock.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let core: dashql.DashQL;

beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

/// A platform over a storage backend, without network and without a compute database
function testPlatform(storage: WorkbookTestBackend): RuntimeOptions {
    const offline = () => { throw new Error('the test has no network'); };
    return {
        logger: new TestLogger(),
        storage,
        http: { fetch: offline } as HttpClient,
        scheduler: TASK_UPDATE_SCHEDULER,
        oauthFlow: { authorizeWithRedirectPage: offline, authorizeWithLoopback: offline } as unknown as OAuthFlow,
        core,
    };
}

/// The next task, the store takes the changes of the runtime at the end of the current one
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the runtime', () => {
    it('writes its workbooks and connections and a second runtime restores them', async () => {
        const storage = new WorkbookTestBackend();
        let first: Runtime | null = createRuntime(testPlatform(storage));
        let second: Runtime | null = null;
        try {
            expect((await first.restore()).workbookIds).toEqual([]);

            const connection = first.createConnection(newDefaultHyperWasmConnection({ active: true }));
            const workbook = first.createWorkbook(connection.connectionId, 'Sales', false);
            await settle();
            expect(first.store.get('workbook', workbook.workbookId)?.name).toBe('Sales');
            expect(first.store.all('connection').get(connection.connectionId)?.workbooks).toEqual([workbook.workbookId]);
            await first.destroy();
            first = null;

            second = createRuntime(testPlatform(storage));
            const restored = await second.restore();
            expect(restored.workbookIds).toEqual([workbook.workbookId]);
            expect(second.store.get('workbook', workbook.workbookId)?.name).toBe('Sales');
            // The runtime of the module took the stored connection, the store shows it
            expect(second.store.all('connection').has(connection.connectionId)).toBe(true);
            expect(second.catalog(connection.connectionId)).not.toBeNull();
        } finally {
            await first?.destroy();
            await second?.destroy();
        }
    });

    it('dispatches an action of the target and settles once the store shows it, refuses an action of another target', async () => {
        const runtime = createRuntime(testPlatform(new WorkbookTestBackend()));
        try {
            await runtime.restore();
            const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: true }));
            const workbook = runtime.createWorkbook(connection.connectionId, 'Sales', false);
            const target = { workbook: workbook.workbookId };

            const renamed = runtime.dispatch(target, { kind: 'renameWorkbook', value: { name: 'Revenue' } });
            expect(renamed).toMatchObject({ ok: true, changed: true });
            await renamed.settled;
            expect(runtime.store.get('workbook', workbook.workbookId)?.name).toBe('Revenue');

            // An action of a connection is no action of a workbook
            const refused = runtime.dispatch(target, { kind: 'discardDraft' } as unknown as dashql.WorkbookAction);
            expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('malformed') });
            await refused.settled;

            // A script that runs nothing has nothing to cancel
            const created = runtime.dispatch(target, { kind: 'createScript', value: { base: 'query', text: 'select 1' } });
            await created.settled;
            const scriptKey = runtime.store.get('workbook', workbook.workbookId)!.scriptKeys[0];
            await runtime.cancelScript(workbook.workbookId, scriptKey);
        } finally {
            await runtime.destroy();
        }
        const destroyed = runtime.dispatch('app', { kind: 'deleteWorkbook', value: { workbookId: 'w' } });
        expect(destroyed.ok).toBe(false);
        await destroyed.settled;
    });

    it('aborts the requests and the OAuth flows of the platform and refuses commands once destroyed', async () => {
        const requests: AbortSignal[] = [];
        const platform = testPlatform(new WorkbookTestBackend());
        platform.http = {
            fetch: (_input, init) => {
                requests.push(init!.signal!);
                return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)));
            },
        } as HttpClient;
        const runtime = createRuntime(platform);
        // The runtime has its module from the start, a dispatch applies at once
        const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: false }));
        expect(runtime.connection(connection.connectionId)?.connectionId).toBe(connection.connectionId);
        // A request of the runtime that hangs, e.g. the health check of a Trino setup
        const trino = { endpoint: 'http://127.0.0.1:1', catalogName: 'hive' } as TrinoConnectionParams;
        const setup = runtime.createConnection({ connectorType: ConnectorType.TRINO, setupParams: trino, params: { trino } });
        const outcome = runtime.setupConnection(setup.connectionId).catch(e => e);
        await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
        await runtime.destroy();
        expect(requests.every(signal => signal.aborted)).toBe(true);
        await outcome;
        expect(runtime.destroyed).toBe(true);
        expect(runtime.dispatch('app', { kind: 'deleteWorkbook', value: { workbookId: 'x' } })).toMatchObject({ ok: false });
        expect(runtime.connection(connection.connectionId)).toBeNull();
        // A second destroy waits for the first
        await runtime.destroy();
    });

    it('keeps a catalog that a holder keeps after its connection went', async () => {
        const runtime = createRuntime(testPlatform(new WorkbookTestBackend()));
        // The connection to the embedded Hyper stays, a Trino connection can go
        const trino = { endpoint: 'http://127.0.0.1:1', catalogName: 'hive' } as TrinoConnectionParams;
        const connection = runtime.createConnection({ connectorType: ConnectorType.TRINO, setupParams: trino, params: { trino } });
        const catalog = runtime.catalog(connection.connectionId)!;
        // One handle per catalog, without reading the view of the connection
        const views = vi.spyOn(runtime.module, 'views');
        expect(runtime.catalog(connection.connectionId)).toBe(catalog);
        expect(views).not.toHaveBeenCalled();
        views.mockRestore();
        expect(runtime.dispatch({ connection: connection.connectionId }, { kind: 'deleteConnection' }).error).toBeNull();
        runtime.flush();
        expect(runtime.catalog(connection.connectionId)).toBeNull();
        // A component that holds the catalog reads it, also after the runtime went
        expect(() => catalog.version()).not.toThrow();
        await runtime.destroy();
        expect(() => catalog.version()).not.toThrow();
    });

    it('destroys the session handles of the scripts after the last changes', async () => {
        // A core of its own that counts the objects of this runtime
        const own = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        const runtime = createRuntime({ ...testPlatform(new WorkbookTestBackend()), core: own });
        const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: false }));
        const workbook = runtime.createWorkbook(connection.connectionId, 'Sessions', false);
        runtime.dispatch({ workbook: workbook.workbookId }, { kind: 'createScript', value: { text: 'select 1', base: 'a' } });
        runtime.flush();
        const scriptKey = runtime.store.get('workbook', workbook.workbookId)!.scriptKeys[0];
        expect(runtime.store.get('script', scriptKey)?.scriptSession).not.toBeNull();
        const destroyed = runtime.destroy();
        // A script changes while the runtime shuts down, the last changes project it
        runtime.module.dispatch({ workbook: workbook.workbookId }, { kind: 'setScriptText', value: { scriptKey, text: 'select 2' } } as never);
        await destroyed;
        const live = [...own.registeredMemory].map(ref => ref.deref()).filter(ptr => ptr != null && !ptr.isNull() && ptr.type.description === 'SCRIPT_SESSION_TYPE');
        expect(live).toEqual([]);
    });

    it('refuses its commands once destroyed instead of calling the freed module', async () => {
        const runtime = createRuntime(testPlatform(new WorkbookTestBackend()));
        const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: false }));
        const workbook = runtime.createWorkbook(connection.connectionId, 'Refused', false);
        await runtime.destroy();
        const metadata = { queryType: 0, title: null, description: null, issuer: null, userProvided: true } as never;
        const [, execution] = runtime.execute(connection.connectionId, { query: 'select 1', metadata });
        await expect(execution).rejects.toThrow('the runtime was destroyed');
        await expect(runtime.setupConnection(connection.connectionId)).rejects.toThrow('the runtime was destroyed');
        await expect(runtime.runWorkbook(workbook.workbookId)).rejects.toThrow('the runtime was destroyed');
        await expect(runtime.exportLink(workbook.workbookId, 'https://dashql.app')).rejects.toThrow('the runtime was destroyed');
        await expect(runtime.restore()).rejects.toThrow('the runtime was destroyed');
        await expect(runtime.settleCatalog(connection.connectionId)).rejects.toThrow('the runtime was destroyed');
        await expect(runtime.renameAttachment(workbook.workbookId, 'sales.parquet', 'revenue')).rejects.toThrow('the runtime was destroyed');
        expect(() => runtime.watchProfile(1)()).not.toThrow();
        await expect(runtime.cancel(1)).resolves.toBeUndefined();
        expect(() => {
            runtime.stopRun(workbook.workbookId);
            runtime.setUpOpenedWorkbook(workbook.workbookId);
            runtime.cancelSetup(connection.connectionId);
            runtime.refreshCatalog(connection.connectionId, true);
            runtime.storage.hold('pause');
            runtime.storage.release('pause');
        }).not.toThrow();
        expect(runtime.storage.getStatistics(workbook.workbookId)).toEqual([]);
        expect(runtime.catalog(connection.connectionId)).toBeNull();
    });

    it('calls the platform no more once it was destroyed, a task that wakes up later is refused', async () => {
        // A storage that fails every write of a workbook file, the writer tries again after a second
        class FailingBackend extends WorkbookTestBackend {
            writes = 0;
            override async saveWorkbookManifest(_workbookId: string, _data: WorkbookData): Promise<void> {
                ++this.writes;
                throw new Error('the disk is full');
            }
        }
        const storage = new FailingBackend();
        const clock = new TestClock();
        const runtime = createRuntime({ ...testPlatform(storage), clock: clock.clock });
        const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: false }));
        runtime.createWorkbook(connection.connectionId, 'Failing', false);
        await runtime.destroy();
        const writes = storage.writes;
        expect(writes).toBeGreaterThan(0);
        // The retry wakes up after the runtime was destroyed
        await clock.elapse();
        expect(storage.writes).toBe(writes);
    });

    it('stops waiting for a compute database that never came up when it is destroyed', async () => {
        const runtime = createRuntime({ ...testPlatform(new WorkbookTestBackend()), computeDatabase: () => new Promise<EmbeddedComputeDatabase>(() => { }) });
        expect(runtime.computeDatabase.ready).toBe(false);
        const analysis = runtime.analyzeTable(1, tableFromArrays({ value: [1, 2, 3] }));
        const failed = analysis.then(() => null, error => error);
        await runtime.destroy();
        expect(await failed).toMatchObject({ message: expect.any(String) });
    });

    it('releases the table of an analysis that fails to start once', async () => {
        const runtime = createRuntime(testPlatform(new WorkbookTestBackend()));
        const release = vi.spyOn(runtime.handles, 'release');
        // No Arrow table, the runtime can't describe it
        const table = { numCols: 1, numRows: 1 } as never;
        await expect(runtime.analyzeTable(1, table)).rejects.toThrow();
        runtime.flush();
        expect(release).toHaveBeenCalledTimes(1);
        expect(runtime.handles.size).toBe(0);
        await runtime.destroy();
    });

    it('unmounts the attachments of a workbook that is deleted', async () => {
        const removed: string[] = [];
        const database = {
            registerExternalDirectory: async () => { },
            removeExternalDirectory: async (path: string) => { removed.push(path); },
            registerExternalFile: async () => { },
            removeExternalFile: async () => { },
            refreshExternalDirectory: async () => { },
        } as unknown as EmbeddedComputeDatabase;
        const runtime = createRuntime({ ...testPlatform(new WorkbookTestBackend()), computeDatabase: async () => database });
        const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: false }));
        const workbook = runtime.createWorkbook(connection.connectionId, 'Mounted', false);
        const path = await runtime.attachmentMounts.mount(database, workbook.workbookId);
        runtime.deleteWorkbook(workbook.workbookId);
        await vi.waitFor(() => expect(removed).toEqual([path]));
        await runtime.destroy();
    });
});
