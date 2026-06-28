import { describe, it, expect } from 'vitest';
import { NotebookRegistry, removeNotebookFromRegistry } from './notebook_state_registry.js';
import { NotebookState } from './notebook_state.js';
import { ConnectorType } from '../connection/connector_info.js';

// removeNotebookFromRegistry only reads notebookMap and entry.connectorInfo.connectorType, so a
// tiny stand-in NotebookState is enough — no Wasm needed.
function notebook(sessionId: string, connectorType: ConnectorType): NotebookState {
    return { sessionId, connectorInfo: { connectorType } } as unknown as NotebookState;
}

function registry(entries: Array<[string, ConnectorType]>): NotebookRegistry {
    const reg: NotebookRegistry = {
        notebookMap: new Map(),
        notebooksByConnection: new Map(),
        notebooksByConnectionType: [[], [], [], []],
    };
    for (const [sessionId, connectorType] of entries) {
        reg.notebookMap.set(sessionId, notebook(sessionId, connectorType));
        reg.notebooksByConnection.set(sessionId, sessionId);
        reg.notebooksByConnectionType[connectorType].push(sessionId);
    }
    return reg;
}

describe('removeNotebookFromRegistry', () => {
    it('drops the entry from all three indices', () => {
        const reg = registry([['a', ConnectorType.HYPER]]);
        const next = removeNotebookFromRegistry(reg, 'a');

        expect(next.notebookMap.has('a')).toBe(false);
        expect(next.notebooksByConnection.has('a')).toBe(false);
        expect(next.notebooksByConnectionType[ConnectorType.HYPER]).not.toContain('a');
    });

    it('leaves sibling sessions of the same connector type intact', () => {
        const reg = registry([['a', ConnectorType.HYPER], ['b', ConnectorType.HYPER]]);
        const next = removeNotebookFromRegistry(reg, 'a');

        expect(next.notebookMap.has('a')).toBe(false);
        expect(next.notebookMap.has('b')).toBe(true);
        expect(next.notebooksByConnection.get('b')).toBe('b');
        expect(next.notebooksByConnectionType[ConnectorType.HYPER]).toEqual(['b']);
    });

    it('only touches the type index of the removed session', () => {
        const reg = registry([['a', ConnectorType.HYPER], ['t', ConnectorType.TRINO]]);
        const next = removeNotebookFromRegistry(reg, 'a');

        expect(next.notebooksByConnectionType[ConnectorType.HYPER]).toEqual([]);
        expect(next.notebooksByConnectionType[ConnectorType.TRINO]).toEqual(['t']);
    });

    it('is a no-op for an unknown session id (returns the same reference)', () => {
        const reg = registry([['a', ConnectorType.HYPER]]);
        const next = removeNotebookFromRegistry(reg, 'missing');

        expect(next).toBe(reg);
        expect(next.notebookMap.has('a')).toBe(true);
    });
});
