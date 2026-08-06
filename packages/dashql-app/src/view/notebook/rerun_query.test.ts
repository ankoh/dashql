import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { REGISTER_QUERY, REGISTER_SCRIPT_OUTPUT_SCHEMA, type ScriptData } from '../../notebook/notebook_state.js';
import { registerNotebookQuery } from './rerun_query.js';

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
