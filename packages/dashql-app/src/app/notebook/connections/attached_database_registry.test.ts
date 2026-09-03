import { describe, expect, it } from 'vitest';

import { ConnectionHealth, type AttachedDatabaseState } from './attached_database_state.js';
import {
    type AttachedDatabaseRegistry,
    didPersistedConnectionChange,
    resolveNotebookAttachedDatabases,
    resolveNotebookExecutionDatabase,
} from './attached_database_registry.js';
import { HYPER_CONNECTOR } from './connector_info.js';

function database(databaseId: string, health: ConnectionHealth): AttachedDatabaseState {
    return { databaseId, connectionHealth: health } as AttachedDatabaseState;
}

function registry(attachedDatabaseId: string | null, mainDatabaseId = attachedDatabaseId ?? 'local'): AttachedDatabaseRegistry {
    return {
        attachedDatabases: new Map([
            ['local', database('local', ConnectionHealth.ONLINE)],
            ['remote', database('remote', ConnectionHealth.FAILED)],
        ]),
        attachedDatabasesByNotebook: new Map([['notebook', {
            mainDatabaseId,
            attachedDatabaseIds: attachedDatabaseId == null ? [] : [attachedDatabaseId],
        }]]),
        attachedDatabasesByType: [],
        attachedDatabasesBySignature: new Map(),
    };
}

describe('notebook attached database routing', () => {
    it('resolves local and remote databases independently', () => {
        const attached = resolveNotebookAttachedDatabases(registry('remote'), 'notebook');
        expect(attached?.main.databaseId).toBe('remote');
        expect(attached?.attached.map(database => database.databaseId)).toEqual(['remote']);
    });

    it('routes execution to the remote main database even when it is offline', () => {
        const execution = resolveNotebookExecutionDatabase(registry('remote'), 'notebook');
        expect(execution?.databaseId).toBe('remote');
        expect(execution?.connectionHealth).toBe(ConnectionHealth.FAILED);
    });

    it('routes execution to the local main database even when a remote is attached', () => {
        expect(resolveNotebookExecutionDatabase(registry('remote', 'local'), 'notebook')?.databaseId).toBe('local');
    });

    it('routes execution to local when it is the only attached database', () => {
        expect(resolveNotebookExecutionDatabase(registry(null), 'notebook')?.databaseId).toBe('local');
    });

    it('does not fall back to local when a configured remote is missing', () => {
        const value = registry('remote', 'remote');
        value.attachedDatabases.delete('remote');
        expect(resolveNotebookExecutionDatabase(value, 'notebook')).toBeNull();
    });
});

describe('notebook manifest persistence', () => {
    const state = (active: boolean, endpoint: string): AttachedDatabaseState => ({
        active,
        details: {
            type: HYPER_CONNECTOR,
            value: {
                proto: {
                    setupParams: {
                        protocol: 'HTTP',
                        endpoint,
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
                    },
                },
            },
        },
    } as unknown as AttachedDatabaseState);

    it('ignores transient connection state changes', () => {
        const prev = state(true, 'https://db.example.com');
        const next = { ...prev, snapshotQueriesActiveFinished: 2 };
        expect(didPersistedConnectionChange(prev, next)).toBe(false);
    });

    it('persists activation and connection parameter changes', () => {
        expect(didPersistedConnectionChange(
            state(false, 'https://db.example.com'),
            state(true, 'https://db.example.com'),
        )).toBe(true);
        expect(didPersistedConnectionChange(
            state(true, 'https://db.example.com'),
            state(true, 'https://other.example.com'),
        )).toBe(true);
    });
});
