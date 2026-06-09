import * as core from '../core/index.js';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDefaultNotebook } from './default_notebook_setup.js';
import { type ConnectionState } from './connection_state.js';
import { createDatalessConnectionState } from './dataless/dataless_connection_state.js';
import type { NotebookStateWithoutId } from '../notebook/notebook_state_registry.js';
import type { NotebookState } from '../notebook/notebook_state.js';
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

describe('createDefaultNotebook', () => {
    it('creates a query page with a notebook-level draft', () => {
        const sessionId = crypto.randomUUID();
        const conn: ConnectionState = {
            ...createDatalessConnectionState(dql!, new Map()),
            sessionId,
        };
        const allocateNotebookState = vi.fn((state: NotebookStateWithoutId): [string, NotebookState] => {
            const sessionId = crypto.randomUUID();
            return [sessionId, { ...state, sessionId }];
        });

        const notebook = createDefaultNotebook(
            conn,
            allocateNotebookState,
            logger,
            'select 1;',
        );

        expect(allocateNotebookState).toHaveBeenCalledTimes(1);
        expect(Object.keys(notebook.notebookPages)).toHaveLength(1);
        expect(notebook.notebookUserFocus.folderName).toBe('Main');
        expect(notebook.notebookUserFocus.fileName.length).toBeGreaterThan(0);
        expect(notebook.notebookUserFocus.interactionCounter).toBe(0);

        const queryPage = notebook.notebookPages['Main'];
        expect(Object.keys(queryPage.scripts)).toHaveLength(1);

        const fileName = notebook.notebookUserFocus.fileName;
        const queryScriptId = queryPage.scripts[fileName].scriptId;
        expect(notebook.uncommittedScriptId).not.toBe(queryScriptId);

        expect(notebook.scripts[queryScriptId]?.script.toString()).toBe('select 1;');
        expect(notebook.scripts[notebook.uncommittedScriptId]).toBeDefined();
    });
});
