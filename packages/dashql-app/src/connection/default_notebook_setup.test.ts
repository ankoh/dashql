import * as core from '../core/index.js';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDefaultNotebookScripts } from './default_notebook_setup.js';
import { type ConnectionState } from './connection_state.js';
import { createDatalessConnectionState } from './dataless/dataless_connection_state.js';
import type { NotebookScriptsInput } from '../scripts/notebook_scripts_registry.js';
import type { NotebookScripts } from '../scripts/notebook_scripts.js';
import { scriptDisplayName } from '../scripts/script_types.js';
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

describe('createDefaultNotebookScripts', () => {
    it('creates a query page with a notebook-level draft', () => {
        const notebookId = crypto.randomUUID();
        const conn: ConnectionState = {
            ...createDatalessConnectionState(dql!, new Map()),
            notebookId,
        };
        const allocateNotebookScripts = vi.fn((state: NotebookScriptsInput): [string, NotebookScripts] => {
            const notebookId = crypto.randomUUID();
            return [notebookId, { ...state, notebookId }];
        });

        const notebookScripts = createDefaultNotebookScripts(
            conn,
            allocateNotebookScripts,
            logger,
            'select 1;',
        );

        expect(allocateNotebookScripts).toHaveBeenCalledTimes(1);
        expect(Object.keys(notebookScripts.scriptFolders)).toHaveLength(1);
        expect(notebookScripts.scriptFocus.folderName).toBe('Main');
        expect(scriptDisplayName(notebookScripts.scriptFocus.fileName)).toBe('example_script');
        expect(notebookScripts.scriptFocus.interactionCounter).toBe(0);

        const queryPage = notebookScripts.scriptFolders['Main'];
        expect(Object.keys(queryPage.scripts)).toHaveLength(1);

        const fileName = notebookScripts.scriptFocus.fileName;
        const queryScriptId = queryPage.scripts[fileName].scriptId;
        expect(notebookScripts.uncommittedScriptId).not.toBe(queryScriptId);

        expect(notebookScripts.scripts[queryScriptId]?.script.toString()).toBe('select 1;');
        expect(notebookScripts.scripts[notebookScripts.uncommittedScriptId]).toBeDefined();
    });
});
