import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { REGISTER_QUERY, REGISTER_SCRIPT_OUTPUT_SCHEMA, type NotebookState, type ScriptData } from '../../notebook/notebook_state.js';
import { createCachedEntryExecutionArgs, registerNotebookQuery } from './rerun_query.js';

function scriptData(query: string, visualizeQuery: ScriptData['annotations']['visualizeQuery'] = null): ScriptData {
    return {
        scriptKey: 7,
        script: { toString: () => query },
        scriptAnalysis: {
            buffers: { analyzed: {} },
            outdated: false,
        },
        annotations: {
            tableRefs: [],
            tableDefs: [],
            restrictedColumns: [],
            visualizeQuery,
        },
        latestQueryId: null,
    } as unknown as ScriptData;
}

describe('registerNotebookQuery', () => {
    const scriptData = { scriptKey: 7 } as ScriptData;

    it('registers the query immediately and publishes a successful output schema', async () => {
        const modifyNotebook = vi.fn();
        const execution = Promise.resolve(arrow.tableFromArrays({ id: [1], name: ['Ada'] }));

        registerNotebookQuery(scriptData, 11, 'SELECT * FROM remote', execution, modifyNotebook);
        expect(modifyNotebook).toHaveBeenNthCalledWith(1, { type: REGISTER_QUERY, value: [7, 11] });
        await execution;
        await Promise.resolve();
        expect(modifyNotebook).toHaveBeenNthCalledWith(2, {
            type: REGISTER_SCRIPT_OUTPUT_SCHEMA,
            value: {
                scriptKey: 7,
                queryId: 11,
                queryText: 'SELECT * FROM remote',
                columnNames: ['id', 'name'],
            },
        });
    });

    it('does not publish a schema for a failed or empty execution', async () => {
        const modifyNotebook = vi.fn();
        const execution = Promise.resolve(null);

        registerNotebookQuery(scriptData, 12, 'SELECT * FROM remote', execution, modifyNotebook);
        await execution;
        await Promise.resolve();
        expect(modifyNotebook).toHaveBeenCalledTimes(1);
    });

    it('registers cache-only executions only after a cache hit', async () => {
        const modifyNotebook = vi.fn();
        const execution = Promise.resolve(arrow.tableFromArrays({ id: [1] }));

        registerNotebookQuery(scriptData, 13, 'SELECT id FROM remote', execution, modifyNotebook, true);
        expect(modifyNotebook).not.toHaveBeenCalled();
        await execution;
        await Promise.resolve();
        expect(modifyNotebook).toHaveBeenNthCalledWith(1, { type: REGISTER_QUERY, value: [7, 13] });
        expect(modifyNotebook).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: REGISTER_SCRIPT_OUTPUT_SCHEMA }));
    });
});

describe('createCachedEntryExecutionArgs', () => {
    const notebook = {} as NotebookState;

    it('loads cached results for plain SQL cards', () => {
        const args = createCachedEntryExecutionArgs(notebook, scriptData('SELECT * FROM remote'));

        expect(args).toEqual(expect.objectContaining({
            query: 'SELECT * FROM remote',
            analyzeResults: true,
            cacheOnly: true,
            projection: undefined,
        }));
        expect(args?.metadata.issuer).toBe('Cached Result Auto-load');
    });

    it('preserves required post-processing for cached UMAP cards', () => {
        const args = createCachedEntryExecutionArgs(notebook, scriptData('visualize source using umap', {
            renderer: 'umap',
            sql: 'SELECT embedding FROM source',
            umapSpec: {
                vectorColumn: 'embedding',
                projection: { method: 'umap', metric: 'euclidean', neighbors: 8 },
            },
        }));

        expect(args?.query).toBe('SELECT embedding FROM source');
        expect(args?.projection).toEqual({
            vectorColumn: 'embedding',
            options: { metric: 'euclidean', nNeighbors: 8 },
        });
    });

    it('does not probe empty cards', () => {
        expect(createCachedEntryExecutionArgs(notebook, scriptData('   '))).toBeNull();
    });
});
