import { describe, expect, it, vi } from 'vitest';

import { ANALYZE_OUTDATED_SCRIPT, REGISTER_QUERY, type NotebookScripts, type ScriptData } from '../scripts/notebook_scripts.js';
import { registerNotebookScriptQuery, runNotebookScript } from './rerun_query.js';

describe('registerNotebookScriptQuery', () => {
    const scriptData = { scriptKey: 7 } as ScriptData;

    it('registers the query immediately', () => {
        const modifyNotebookScripts = vi.fn();
        const execution = Promise.resolve(null);

        registerNotebookScriptQuery(scriptData, 11, 'SELECT * FROM remote', execution, modifyNotebookScripts);
        expect(modifyNotebookScripts).toHaveBeenCalledOnce();
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [7, 11] });
    });
});

describe('runNotebookScript', () => {
    it('analyzes an outdated script before compiling and executing it', async () => {
        const compileQuery = vi.fn(() => ({
            read: () => ({ errorsLength: () => 0, sql: () => 'SELECT 1' }),
            destroy: () => { },
        }));
        const outdated = {
            scriptKey: 7,
            editorSession: { compileQuery },
            analysisOutdated: true,
            annotations: { visualizeQuery: null },
            latestQueryId: null,
        } as unknown as ScriptData;
        const analyzed = {
            ...outdated,
            analysisOutdated: false,
        };
        const notebookScripts = { scripts: { 7: outdated } } as unknown as NotebookScripts;
        const modifyNotebookScripts = vi.fn((action) => {
            if (action.type === ANALYZE_OUTDATED_SCRIPT) {
                return Promise.resolve({ scripts: { 7: analyzed } } as unknown as NotebookScripts);
            }
        });
        const executeQuery = vi.fn(() => [11, Promise.resolve(null)] as [number, Promise<null>]);

        const execution = runNotebookScript(
            'connection',
            notebookScripts,
            outdated,
            executeQuery,
            modifyNotebookScripts,
            { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as any,
        );
        expect(executeQuery).not.toHaveBeenCalled();
        await execution;

        expect(modifyNotebookScripts).toHaveBeenNthCalledWith(1, {
            type: ANALYZE_OUTDATED_SCRIPT,
            value: 7,
        });
        expect(compileQuery).toHaveBeenCalledOnce();
        expect(executeQuery).toHaveBeenCalledWith('connection', expect.objectContaining({
            query: 'SELECT 1',
            cacheable: true,
        }));
        expect(modifyNotebookScripts).toHaveBeenNthCalledWith(2, {
            type: REGISTER_QUERY,
            value: [7, 11],
        });
    });
});
