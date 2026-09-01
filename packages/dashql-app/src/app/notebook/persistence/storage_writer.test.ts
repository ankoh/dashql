import { describe, expect, it } from 'vitest';

import { Logger } from '../../../platform/logger/logger.js';
import { NotebookTestBackend } from './notebook_test_backend.js';
import {
    DELETE_SCRIPT,
    groupScriptDeletes,
    groupScriptRenames,
    groupScriptWrites,
    RENAME_SCRIPT,
    StorageWriter,
    WRITE_NOTEBOOK_MANIFEST,
    WRITE_SCRIPT,
} from './storage_writer.js';
import { ConnectorType, HYPER_CONNECTOR, TRINO_CONNECTOR } from '../connections/connector_info.js';
import type { AttachedDatabaseState } from '../connections/attached_database_state.js';

class NullLogger extends Logger {
    public destroy(): void {}
    protected flushPendingRecords(): void {}
}

describe('V2 storage writer flat mutations', () => {
    it('round-trips local and remote attached databases with an explicit main database', async () => {
        const backend = new NotebookTestBackend();
        const writer = new StorageWriter(new NullLogger(), backend);
        const notebookId = '11111111-2222-4333-8444-555555555555';
        const state = (databaseId: string, connectorType: ConnectorType, setupParams: object) => ({
            databaseId,
            connectorInfo: { connectorType },
            details: connectorType === ConnectorType.HYPER
                ? { type: HYPER_CONNECTOR, value: { proto: { setupParams } } }
                : { type: TRINO_CONNECTOR, value: { proto: { setupParams } } },
        }) as unknown as AttachedDatabaseState;

        await writer.write(notebookId, {
            type: WRITE_NOTEBOOK_MANIFEST,
            value: [notebookId, 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb', [
                state('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', ConnectorType.HYPER, { protocol: 'WASM' }),
                state('ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb', ConnectorType.TRINO, { endpoint: 'https://trino.example' }),
            ]],
        });

        expect((await backend.loadNotebook(notebookId)).attachedDatabases).toEqual([
            { databaseId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: { protocol: 'WASM' } } },
        ]);
        expect((await backend.loadNotebook(notebookId)).mainDatabase.databaseId).toBe('ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb');
    });

    it('keeps rename, write, and delete in distinct ordered keyspaces', async () => {
        const backend = new NotebookTestBackend();
        const writer = new StorageWriter(new NullLogger(), backend);
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
});
