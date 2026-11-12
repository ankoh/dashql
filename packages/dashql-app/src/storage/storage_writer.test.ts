import { describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../platform/logger/test_logger.js';
import { WorkbookTestBackend } from './workbook_test_backend.js';
import {
    DELETE_SCRIPT,
    groupScriptDeletes,
    groupScriptRenames,
    groupScriptWrites,
    RENAME_SCRIPT,
    StorageWriter,
    WRITE_WORKBOOK_MANIFEST,
    WRITE_SCRIPT,
    WRITE_WORKBOOK_PROPERTIES,
    WRITE_CONNECTION_ENTRY,
    PATCH_WORKBOOK_CONNECTION,
    WorkbookUnavailableError,
    groupConnectionEntryWrites,
    groupWorkbookConnectionCopyWrites,
    groupWorkbookManifestWrites,
    groupWorkbookScriptListWrites,
    groupWorkbookWrites,
    REPLACE_WORKBOOK_SCRIPTS,
    WRITE_WORKBOOK_SCRIPTS,
    storageWriteChainKey,
    type StorageWriteTaskVariant,
} from './storage_writer.js';
import { ExternalScriptChangeError } from './storage_backend.js';
import { ConnectorType, HYPER_CONNECTOR, TRINO_CONNECTOR } from '../connections/connector_info.js';
import { ConnectionHealth, ConnectionStatus, DISCARD_CONNECTION_DRAFT, SET_CONNECTION_DRAFT, reduceConnectionState, type ConnectionState } from '../connections/connection_state.js';
import { CONNECTOR_INFOS } from '../connections/connector_info.js';
import { workbookConnectionFromState } from '../connections/connection_registry.js';
import { testConnections, testWorkbook, TEST_CONNECTION_ID, TEST_WORKBOOK_ID } from './workbook_test_backend.js';

describe('V2 storage writer flat mutations', () => {
    it.each(['name-first', 'connection-first'])('retains rename and connection copy in separate debounced tasks (%s)', async order => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const params = { trino: { endpoint: 'committed', catalogName: '', auth: { authType: 'AUTH_BASIC' as const } } };
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({ ...testConnections({ connectionId: TEST_CONNECTION_ID, params } as any) }));
        for (const endpoint of ['saved', 'saved again']) {
            const saved = { trino: { ...params.trino, endpoint } };
            const name = `renamed before ${endpoint}`;
            const rename = () => writer.write(groupWorkbookManifestWrites(TEST_WORKBOOK_ID), {
                type: WRITE_WORKBOOK_PROPERTIES, value: [TEST_WORKBOOK_ID, { name }],
            }, 10_000);
            const connection = () => writer.write(groupWorkbookConnectionCopyWrites(TEST_WORKBOOK_ID, TEST_CONNECTION_ID), {
                type: PATCH_WORKBOOK_CONNECTION, value: [TEST_WORKBOOK_ID, { connectionId: TEST_CONNECTION_ID, params: saved }],
            }, 10_000);
            const tasks = order === 'name-first' ? [rename(), connection()] : [connection(), rename()];
            expect(writer.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toHaveLength(2);
            await writer.flush();
            await expect(Promise.all(tasks)).resolves.toEqual([true, true]);
            const workbook = await backend.loadWorkbook(TEST_WORKBOOK_ID);
            expect(workbook.name).toBe(name);
            expect(workbook.connections).toEqual([{ connectionId: TEST_CONNECTION_ID, params: saved }]);
        }
    });
    it('writes the marker of an ephemeral workbook, keeps it and removes it on promotion', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const connection = testWorkbook().connections[0];
        const write = async (task: StorageWriteTaskVariant) => {
            await writer.write(groupWorkbookManifestWrites(TEST_WORKBOOK_ID), task, 0);
            await writer.flush();
            return backend.loadWorkbook(TEST_WORKBOOK_ID);
        };
        const created = await write({ type: WRITE_WORKBOOK_MANIFEST, value: [TEST_WORKBOOK_ID, [connection], { ephemeral: true }] });
        expect(created.metadata.ephemeral).toBe(true);

        // A connection change rewrites the manifest and a whole workbook may be written while it is ephemeral
        const rewritten = await write({ type: WRITE_WORKBOOK_MANIFEST, value: [TEST_WORKBOOK_ID, [connection]] });
        expect(rewritten.metadata.ephemeral).toBe(true);
        await writer.write(groupWorkbookWrites(TEST_WORKBOOK_ID), {
            type: REPLACE_WORKBOOK_SCRIPTS,
            value: { workbookId: TEST_WORKBOOK_ID, name: 'New Workbook', scripts: [], connection, originalFileName: '' },
        }, 0);
        await writer.flush();
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).metadata.ephemeral).toBe(true);

        // The properties keep it while the workbook stays ephemeral
        const kept = await write({ type: WRITE_WORKBOOK_PROPERTIES, value: [TEST_WORKBOOK_ID, { name: 'New Workbook', ephemeral: true }] });
        expect(kept.metadata.ephemeral).toBe(true);
        const promoted = await write({ type: WRITE_WORKBOOK_PROPERTIES, value: [TEST_WORKBOOK_ID, { name: 'Untitled' }] });
        expect(promoted.name).toBe('Untitled');
        expect('ephemeral' in promoted.metadata).toBe(false);
    });

    it('writes and removes the link to a published workbook of the cloud with the properties', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        const write = async (task: StorageWriteTaskVariant) => {
            await writer.write(groupWorkbookManifestWrites(TEST_WORKBOOK_ID), task, 0);
            await writer.flush();
            return backend.loadWorkbook(TEST_WORKBOOK_ID);
        };
        const cloud = { workbookId: 'c0ffee00-0000-4000-8000-000000000001', versionId: 'c0ffee00-0000-4000-8000-000000000002' };
        const previewed = await write({ type: WRITE_WORKBOOK_PROPERTIES, value: [TEST_WORKBOOK_ID, { name: 'Published', cloud: { ...cloud, preview: true } }] });
        expect(previewed.metadata.cloud).toEqual({ ...cloud, preview: true });
        const imported = await write({ type: WRITE_WORKBOOK_PROPERTIES, value: [TEST_WORKBOOK_ID, { name: 'Published', cloud }] });
        expect(imported.metadata.cloud).toEqual(cloud);
        const unlinked = await write({ type: WRITE_WORKBOOK_PROPERTIES, value: [TEST_WORKBOOK_ID, { name: 'Published' }] });
        expect('cloud' in unlinked.metadata).toBe(false);
    });

    it('patches the script list with its connections without losing pending property writes', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const remoteId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';
        const remote = { connectionId: remoteId, params: { trino: { endpoint: 'remote' } } as any };
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        const scripts = [{ name: 'b.sql', connectionId: remoteId }, { name: 'a.sql', connectionId: TEST_CONNECTION_ID }];
        const tasks = [
            writer.write(groupWorkbookManifestWrites(TEST_WORKBOOK_ID), {
                type: WRITE_WORKBOOK_PROPERTIES, value: [TEST_WORKBOOK_ID, { name: 'renamed' }],
            }, 10_000),
            writer.write(groupWorkbookScriptListWrites(TEST_WORKBOOK_ID), {
                type: WRITE_WORKBOOK_SCRIPTS, value: [TEST_WORKBOOK_ID, { scripts, connections: [remote] }],
            }, 10_000),
        ];
        await writer.flush();
        await Promise.all(tasks);
        const workbook = await backend.loadWorkbook(TEST_WORKBOOK_ID);
        expect(workbook.name).toBe('renamed');
        // The connections follow the scripts in the order the scripts use them
        expect(workbook.connections).toEqual([remote, testWorkbook().connections[0]]);
        expect(workbook.scripts).toEqual(scripts);

        // A manifest rewrite keeps the script list and the connections of its scripts
        await writer.write(groupWorkbookManifestWrites(TEST_WORKBOOK_ID), {
            type: WRITE_WORKBOOK_MANIFEST, value: [TEST_WORKBOOK_ID, [testWorkbook().connections[0]]],
        }, 0);
        await writer.flush();
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).scripts).toEqual(scripts);
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).connections).toEqual([remote, testWorkbook().connections[0]]);

        // Once no script uses the remote connection, the workbook drops its copy
        await writer.write(groupWorkbookScriptListWrites(TEST_WORKBOOK_ID), {
            type: WRITE_WORKBOOK_SCRIPTS, value: [TEST_WORKBOOK_ID, { scripts: [{ name: 'a.sql', connectionId: TEST_CONNECTION_ID }], connections: [] }],
        }, 0);
        await writer.flush();
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).connections).toEqual([testWorkbook().connections[0]]);
    });

    it('keeps the latest script list when the workbook file is rewritten in between', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        const list = (names: string[]) => ({ scripts: names.map(name => ({ name, connectionId: TEST_CONNECTION_ID })), connections: [] });
        // The first list write arms the timer, the rewrite of the workbook file follows, the latest list
        // supersedes the first one and keeps its earlier timer
        const tasks = [
            writer.write(groupWorkbookScriptListWrites(TEST_WORKBOOK_ID), { type: WRITE_WORKBOOK_SCRIPTS, value: [TEST_WORKBOOK_ID, list(['a.sql'])] }, 10_000),
            writer.write(groupWorkbookWrites(TEST_WORKBOOK_ID), {
                type: REPLACE_WORKBOOK_SCRIPTS,
                value: {
                    workbookId: TEST_WORKBOOK_ID, name: null, scripts: [{ fileName: 'a.sql', readText: () => 'SELECT 1' }],
                    connection: testWorkbook().connections[0], originalFileName: undefined,
                },
            }, 10_000),
            writer.write(groupWorkbookScriptListWrites(TEST_WORKBOOK_ID), { type: WRITE_WORKBOOK_SCRIPTS, value: [TEST_WORKBOOK_ID, list(['b.sql', 'a.sql'])] }, 10_000),
        ];
        await writer.flush();
        await Promise.all(tasks);
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).scripts).toEqual(list(['b.sql', 'a.sql']).scripts);
    });

    it('writes drafts into the app manifest and never into workbooks', async () => {
        const backend = new WorkbookTestBackend();
        const logger = new TestLogger();
        const writer = new StorageWriter(logger, backend);
        const params = { trino: { endpoint: 'committed', catalogName: '', auth: { authType: 'AUTH_BASIC' as const } } };
        const paramsDraft = { trino: { ...params.trino, endpoint: 'unfinished' } };
        let state = {
            connectionId: TEST_CONNECTION_ID, params,
            connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO],
            connectionHealth: ConnectionHealth.NOT_STARTED, connectionStatus: ConnectionStatus.NOT_STARTED,
            details: { type: TRINO_CONNECTOR, value: { proto: { setupParams: params.trino, setupTimings: {} } } },
        } as ConnectionState;
        for (const discard of [false, true]) {
            state = reduceConnectionState(state, discard
                ? { type: DISCARD_CONNECTION_DRAFT, value: null }
                : { type: SET_CONNECTION_DRAFT, value: paramsDraft }, logger);
            await writer.write(groupConnectionEntryWrites(TEST_CONNECTION_ID), {
                type: WRITE_CONNECTION_ENTRY,
                value: { id: TEST_CONNECTION_ID, params: state.params, ...(state.paramsDraft ? { paramsDraft: state.paramsDraft } : {}) },
            });
            expect(backend.connections).toEqual([{ id: TEST_CONNECTION_ID, params, ...(discard ? {} : { paramsDraft }) }]);
        }
        expect(backend.workbooks.size).toBe(0);
    });
    it('persists only committed settings, not drafts, attempted params or OAuth runtime state', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const workbookId = '11111111-2222-4333-8444-555555555555';
        const connectionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const state = {
            connectionId,
            params: { trino: { endpoint: 'committed' } },
            paramsDraft: { trino: { endpoint: '' } },
            details: { type: TRINO_CONNECTOR, value: { proto: {
                setupParams: { endpoint: 'attempted' },
                oauthState: { accessToken: { accessToken: 'runtime-secret' } },
            } } },
        } as unknown as ConnectionState;
        await writer.write(workbookId, { type: WRITE_WORKBOOK_MANIFEST, value: [workbookId, [workbookConnectionFromState(state)]] });
        const saved = await backend.loadWorkbook(workbookId);
        expect(saved.connections).toEqual([{ connectionId, params: state.params }]);
        expect(JSON.stringify(saved)).not.toContain('runtime-secret');
    });
    it('keeps the connections of the scripts when the manifest is written', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const workbookId = '11111111-2222-4333-8444-555555555555';
        const state = (connectionId: string, connectorType: ConnectorType, setupParams: object) => ({
            connectionId,
            connectorInfo: { connectorType },
            params: connectorType === ConnectorType.HYPER ? { hyper: setupParams } : { trino: setupParams },
            details: connectorType === ConnectorType.HYPER
                ? { type: HYPER_CONNECTOR, value: { proto: { setupParams } } }
                : { type: TRINO_CONNECTOR, value: { proto: { setupParams } } },
        }) as unknown as ConnectionState;
        // A script of the workbook runs on the local connection
        backend.workbooks.set(workbookId, testWorkbook({ scripts: [{ name: 'local.sql', connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }] }));

        await writer.write(workbookId, {
            type: WRITE_WORKBOOK_MANIFEST,
            value: [workbookId, [
                state('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', ConnectorType.HYPER, { protocol: 'WASM' }),
                state('ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb', ConnectorType.TRINO, { endpoint: 'https://trino.example' }),
            ].map(workbookConnectionFromState)],
        });

        // A connection that no script uses is left out, the given copy of the used one wins
        expect((await backend.loadWorkbook(workbookId)).connections).toEqual([
            { connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: { protocol: 'WASM' } } },
        ]);
    });

    it('keeps rename, write, and delete in distinct ordered keyspaces', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const id = '11111111-2222-4333-8444-555555555555';
        await backend.saveScript(id, '01_old.sql', 'old');
        backend.calls.length = 0;

        const rename = writer.write(groupScriptRenames(id, '01_old.sql'), {
            type: RENAME_SCRIPT, value: [id, '01_old.sql', '01_new.sql'],
        }, 10_000);
        const write = writer.write(groupScriptWrites(id, '01_new.sql'), {
            type: WRITE_SCRIPT, value: [id, '01_new.sql', 'new'],
        }, 10_000);
        const remove = writer.write(groupScriptDeletes(id, '02_unused.sql'), {
            type: DELETE_SCRIPT, value: [id, '02_unused.sql'],
        }, 10_000);
        await writer.flush();
        await expect(Promise.all([rename, write, remove])).resolves.toEqual([true, true, true]);
        expect(backend.calls).toEqual([
            `rename:${id}/01_old.sql->01_new.sql`,
            `write:${id}/01_new.sql=new`,
            `delete:${id}/02_unused.sql`,
        ]);
        expect(await backend.loadScript(id, '01_new.sql')).toEqual({ name: '01_new.sql', sql: 'new' });
    });

    it('does not overlap mutations of different files in the same workbook', async () => {
        let beginDelete!: () => void;
        let finishDelete!: () => void;
        const deleting = new Promise<void>(resolve => { beginDelete = resolve; });
        const releaseDelete = new Promise<void>(resolve => { finishDelete = resolve; });
        class PausedBackend extends WorkbookTestBackend {
            override async deleteScript(workbookId: string, scriptName: string): Promise<void> {
                beginDelete();
                await releaseDelete;
                await super.deleteScript(workbookId, scriptName);
            }
        }
        const backend = new PausedBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const id = '11111111-2222-4333-8444-555555555555';

        const deletion = writer.write(groupScriptDeletes(id, '02_old.sql'), {
            type: DELETE_SCRIPT, value: [id, '02_old.sql'],
        });
        await deleting;
        const write = writer.write(groupScriptWrites(id, '03_new.sql'), {
            type: WRITE_SCRIPT, value: [id, '03_new.sql', 'SELECT 3'],
        }, 10_000);
        const flushing = writer.flush();
        try {
            // Flush has started the next mutation, but it must wait for the first one.
            expect(backend.calls).not.toContain(`write:${id}/03_new.sql=SELECT 3`);
        } finally {
            finishDelete();
        }
        await expect(Promise.all([deletion, write, flushing])).resolves.toEqual([true, true, undefined]);
        expect(backend.calls).toEqual([
            `delete:${id}/02_old.sql`,
            `write:${id}/03_new.sql=SELECT 3`,
        ]);
    });
});

describe('storage writer outcomes', () => {
    it('chains global keys per entity and workbook keys per workbook', () => {
        expect(storageWriteChainKey(`${TEST_WORKBOOK_ID}/scripts/01.sql`)).toBe(TEST_WORKBOOK_ID);
        expect(storageWriteChainKey(groupWorkbookConnectionCopyWrites(TEST_WORKBOOK_ID, TEST_CONNECTION_ID))).toBe(TEST_WORKBOOK_ID);
        expect(storageWriteChainKey(groupConnectionEntryWrites(TEST_CONNECTION_ID))).toBe('@manifest');
        expect(storageWriteChainKey(`@connections/${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`)).toBe(`@connections/${TEST_CONNECTION_ID}`);
    });

    it('writes durably without debouncing and defers while paused', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const params = (endpoint: string) => ({ trino: { endpoint } }) as any;
        const debounced = writer.write(groupConnectionEntryWrites(TEST_CONNECTION_ID), {
            type: WRITE_CONNECTION_ENTRY, value: { id: TEST_CONNECTION_ID, params: params('draft') },
        }, 10_000);
        await expect(writer.writeDurable(groupConnectionEntryWrites(TEST_CONNECTION_ID), {
            type: WRITE_CONNECTION_ENTRY, value: { id: TEST_CONNECTION_ID, params: params('saved') },
        })).resolves.toEqual({ status: 'written' });
        await expect(debounced).resolves.toBe(false);
        expect(backend.connections).toEqual([{ id: TEST_CONNECTION_ID, params: params('saved') }]);

        writer.pause();
        await expect(writer.writeDurable(groupConnectionEntryWrites(TEST_CONNECTION_ID), {
            type: WRITE_CONNECTION_ENTRY, value: { id: TEST_CONNECTION_ID, params: params('paused') },
        })).resolves.toEqual({ status: 'deferred' });
        expect(backend.connections).toEqual([{ id: TEST_CONNECTION_ID, params: params('saved') }]);
        writer.resume();
        await writer.flush();
        expect(backend.connections).toEqual([{ id: TEST_CONNECTION_ID, params: params('paused') }]);
    });

    it('reports failed writes and never recreates a missing workbook', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const result = await writer.writeDurable(groupWorkbookConnectionCopyWrites(TEST_WORKBOOK_ID, TEST_CONNECTION_ID), {
            type: PATCH_WORKBOOK_CONNECTION, value: [TEST_WORKBOOK_ID, { connectionId: TEST_CONNECTION_ID, params: { trino: { endpoint: 'x' } } as any }],
        });
        expect(result.status).toBe('failed');
        expect(result.status === 'failed' && result.error).toBeInstanceOf(WorkbookUnavailableError);
        expect(backend.workbooks.size).toBe(0);
    });

    it('drops pending and later writes of a deleted workbook', async () => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook());
        const writer = new StorageWriter(new TestLogger(), backend);
        const pending = writer.write(groupScriptWrites(TEST_WORKBOOK_ID, 'a.sql'), { type: WRITE_SCRIPT, value: [TEST_WORKBOOK_ID, 'a.sql', 'select 1'] }, 1000);
        await writer.deleteWorkbook(TEST_WORKBOOK_ID);
        expect(await pending).toBe(false);
        expect(await writer.write(groupScriptWrites(TEST_WORKBOOK_ID, 'b.sql'), { type: WRITE_SCRIPT, value: [TEST_WORKBOOK_ID, 'b.sql', 'select 2'] })).toBe(false);
        await writer.flush();
        expect(backend.workbooks.has(TEST_WORKBOOK_ID)).toBe(false);
        expect(backend.calls.filter(call => call.startsWith('write:'))).toEqual([]);
    });

    it('accepts writes again when a deleted workbook is registered again', async () => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook());
        const writer = new StorageWriter(new TestLogger(), backend);
        await writer.deleteWorkbook(TEST_WORKBOOK_ID);
        // An import of the same bundle registers the id again
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook());
        writer.reviveWorkbook(TEST_WORKBOOK_ID);
        expect(await writer.write(groupScriptWrites(TEST_WORKBOOK_ID, 'a.sql'), { type: WRITE_SCRIPT, value: [TEST_WORKBOOK_ID, 'a.sql', 'select 1'] })).toBe(true);
        expect(backend.calls).toContain(`write:${TEST_WORKBOOK_ID}/a.sql=select 1`);
    });

    it('patches the copies of a connection and rewrites the connections it replaced', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const merged = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';
        const old = { trino: { endpoint: 'old' } } as any;
        const next = { trino: { endpoint: 'new' } } as any;
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections({ connectionId: TEST_CONNECTION_ID, params: old, paramsDraft: old } as any, { connectionId: merged, params: old }),
        }));
        backend.calls.length = 0;
        const result = await writer.writeDurable(groupWorkbookConnectionCopyWrites(TEST_WORKBOOK_ID, TEST_CONNECTION_ID), {
            type: PATCH_WORKBOOK_CONNECTION, value: [TEST_WORKBOOK_ID, { connectionId: TEST_CONNECTION_ID, params: next }, [merged]],
        });
        expect(result).toEqual({ status: 'written' });
        const workbook = await backend.loadWorkbook(TEST_WORKBOOK_ID);
        expect(workbook.connections).toEqual([{ connectionId: TEST_CONNECTION_ID, params: next }]);
        // An up-to-date copy is not written again
        await writer.writeDurable(groupWorkbookConnectionCopyWrites(TEST_WORKBOOK_ID, TEST_CONNECTION_ID), {
            type: PATCH_WORKBOOK_CONNECTION, value: [TEST_WORKBOOK_ID, { connectionId: TEST_CONNECTION_ID, params: next }],
        });
        expect(backend.calls).toEqual([`manifest:${TEST_WORKBOOK_ID}`]);
    });

    it('keeps the creation time of connection entries', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        backend.connections = [{ id: TEST_CONNECTION_ID, params: { trino: { endpoint: 'a' } } as any, createdAt: '2026-01-01T00:00:00.000Z' }];
        await writer.writeDurable(groupConnectionEntryWrites(TEST_CONNECTION_ID), {
            type: WRITE_CONNECTION_ENTRY, value: { id: TEST_CONNECTION_ID, params: { trino: { endpoint: 'b' } } as any },
        });
        expect(backend.connections).toEqual([{ id: TEST_CONNECTION_ID, params: { trino: { endpoint: 'b' } }, createdAt: '2026-01-01T00:00:00.000Z' }]);
    });
});

describe('storage writer workbook flush', () => {
    const patch = (workbookId: string, endpoint: string): StorageWriteTaskVariant => ({
        type: PATCH_WORKBOOK_CONNECTION,
        value: [workbookId, { connectionId: TEST_CONNECTION_ID, params: { trino: { endpoint } } as any }],
    });

    it('writes the pending tasks of a workbook right away and leaves the other workbooks pending', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveWorkbookManifest('other', testWorkbook());
        const written = writer.write(groupWorkbookConnectionCopyWrites(TEST_WORKBOOK_ID, TEST_CONNECTION_ID), patch(TEST_WORKBOOK_ID, 'flushed'), 10_000);
        void writer.write(groupWorkbookConnectionCopyWrites('other', TEST_CONNECTION_ID), patch('other', 'pending'), 10_000);

        await expect(writer.flushWorkbook(TEST_WORKBOOK_ID)).resolves.toBe(true);
        await expect(written).resolves.toBe(true);
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).connections).toEqual([{ connectionId: TEST_CONNECTION_ID, params: { trino: { endpoint: 'flushed' } } }]);
        expect(writer.getPendingKeysForWorkbook('other')).toHaveLength(1);
        // A workbook without pending writes is written
        await expect(writer.flushWorkbook(TEST_WORKBOOK_ID)).resolves.toBe(true);
        writer.cancelPendingWritesForWorkbook('other');
    });

    it('never forces the writes of a held workbook', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        void writer.write(groupWorkbookConnectionCopyWrites(TEST_WORKBOOK_ID, TEST_CONNECTION_ID), patch(TEST_WORKBOOK_ID, 'held'), 10_000);
        writer.pauseWorkbook(TEST_WORKBOOK_ID);
        expect(writer.isWorkbookPaused(TEST_WORKBOOK_ID)).toBe(true);

        await expect(writer.flushWorkbook(TEST_WORKBOOK_ID)).resolves.toBe(false);
        expect(writer.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toHaveLength(1);
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).connections).toEqual(testWorkbook().connections);

        writer.resumeWorkbook(TEST_WORKBOOK_ID);
        expect(writer.isWorkbookPaused(TEST_WORKBOOK_ID)).toBe(false);
        await expect(writer.flushWorkbook(TEST_WORKBOOK_ID)).resolves.toBe(true);
    });

    it('keeps a failed write pending for the next flush', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const key = groupWorkbookConnectionCopyWrites(TEST_WORKBOOK_ID, TEST_CONNECTION_ID);
        // The workbook file is missing, the patch fails
        const failed = writer.write(key, patch(TEST_WORKBOOK_ID, 'retried'), 10_000);
        await expect(writer.flushWorkbook(TEST_WORKBOOK_ID)).resolves.toBe(false);
        await expect(failed).resolves.toBe(false);
        expect(writer.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toEqual([key]);

        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await expect(writer.flushWorkbook(TEST_WORKBOOK_ID)).resolves.toBe(true);
        expect(writer.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toEqual([]);
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).connections).toEqual([{ connectionId: TEST_CONNECTION_ID, params: { trino: { endpoint: 'retried' } } }]);
    });
});

describe('storage writer external changes', () => {
    /// A backend whose scripts changed outside the app until the change is resolved
    class ExternallyChangedBackend extends WorkbookTestBackend {
        changed = true;
        async saveScript(workbookId: string, scriptName: string, sql: string): Promise<void> {
            if (this.changed) throw new ExternalScriptChangeError(workbookId, scriptName);
            await super.saveScript(workbookId, scriptName, sql);
        }
    }

    it('holds a write that would overwrite an external change until the workbook resumes', async () => {
        const backend = new ExternallyChangedBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const changed: string[] = [];
        writer.subscribeExternalChanges(workbookId => changed.push(workbookId));

        let settled = false;
        const key = groupScriptWrites(TEST_WORKBOOK_ID, 'a.sql');
        const pending = writer.write(key, { type: WRITE_SCRIPT, value: [TEST_WORKBOOK_ID, 'a.sql', 'select 1'] })
            .then(result => { settled = true; return result; });
        await new Promise(resolve => setTimeout(resolve, 10));
        await writer.settle();
        expect(changed).toEqual([TEST_WORKBOOK_ID]);
        expect(settled).toBe(false);
        expect(writer.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toEqual([key]);

        // Other workbooks keep writing while the workbook is held
        expect(await writer.writeDurable(groupWorkbookManifestWrites('other'), {
            type: WRITE_WORKBOOK_MANIFEST, value: ['other', [{ connectionId: TEST_CONNECTION_ID, params: {} as any }]],
        })).toEqual({ status: 'written' });

        backend.changed = false;
        writer.resumeWorkbook(TEST_WORKBOOK_ID);
        expect(await pending).toBe(true);
        expect(await backend.loadScript(TEST_WORKBOOK_ID, 'a.sql')).toEqual({ name: 'a.sql', sql: 'select 1' });
    });

    it('lets a newer write of the same script supersede a held one', async () => {
        const backend = new ExternallyChangedBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const key = groupScriptWrites(TEST_WORKBOOK_ID, 'a.sql');
        const held = writer.write(key, { type: WRITE_SCRIPT, value: [TEST_WORKBOOK_ID, 'a.sql', 'select 1'] });
        await new Promise(resolve => setTimeout(resolve, 10));
        await writer.settle();
        const newer = writer.write(key, { type: WRITE_SCRIPT, value: [TEST_WORKBOOK_ID, 'a.sql', 'select 2'] });
        expect(await held).toBe(false);
        writer.cancelPendingWritesForWorkbook(TEST_WORKBOOK_ID);
        expect(await newer).toBe(false);
        expect(backend.calls.filter(call => call.startsWith('write:'))).toEqual([]);
    });
});
