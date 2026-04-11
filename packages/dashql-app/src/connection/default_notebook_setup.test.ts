import * as core from '../core/index.js';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDefaultNotebookWithSchemaPage } from './default_notebook_setup.js';
import { createDatalessConnectionState, type ConnectionState } from './connection_state.js';
import type { NotebookStateWithoutId } from '../notebook/notebook_state_registry.js';
import { Logger } from '../platform/logger/logger.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

let dql: core.DashQL | null = null;
const logger = new NullLogger();

beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await core.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});

afterEach(() => {
    dql!.resetUnsafe();
});

describe('createDefaultNotebookWithSchemaPage', () => {
    it('creates separate query and schema pages with a notebook-level draft', () => {
        const conn: ConnectionState = {
            ...createDatalessConnectionState(dql!, new Map()),
            connectionId: 1,
        };
        const allocateNotebookState = vi.fn((state: NotebookStateWithoutId) => ({
            ...state,
            notebookId: 7,
        }));

        const notebook = createDefaultNotebookWithSchemaPage(
            conn,
            allocateNotebookState,
            logger,
            'select 1;',
            'create table lineitem(l_orderkey integer);',
        );

        expect(allocateNotebookState).toHaveBeenCalledTimes(1);
        expect(notebook.notebookPages).toHaveLength(2);
        expect(notebook.notebookUserFocus).toEqual({ pageIndex: 0, entryInPage: 0 });

        const queryPage = notebook.notebookPages[0];
        const schemaPage = notebook.notebookPages[1];
        expect(queryPage.scripts).toHaveLength(1);
        expect(schemaPage.scripts).toHaveLength(1);

        const queryScriptId = queryPage.scripts[0].scriptId;
        const schemaScriptId = schemaPage.scripts[0].scriptId;
        expect(queryScriptId).not.toBe(schemaScriptId);
        expect(notebook.uncommittedScriptId).not.toBe(queryScriptId);
        expect(notebook.uncommittedScriptId).not.toBe(schemaScriptId);

        expect(notebook.scripts[queryScriptId]?.script.toString()).toBe('select 1;');
        expect(notebook.scripts[schemaScriptId]?.script.toString()).toBe('create table lineitem(l_orderkey integer);');
        expect(notebook.scripts[notebook.uncommittedScriptId]).toBeDefined();
    });
});
