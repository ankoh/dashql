import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { REGISTER_QUERY, REGISTER_SCRIPT_OUTPUT_SCHEMA, type ScriptData } from '../../scripts/notebook_scripts.js';
import { registerNotebookScriptQuery } from './rerun_query.js';

describe('registerNotebookScriptQuery', () => {
    const scriptData = { scriptKey: 7 } as ScriptData;

    it('registers the query immediately and publishes a successful output schema', async () => {
        const modifyNotebookScripts = vi.fn();
        const execution = Promise.resolve(arrow.tableFromArrays({ id: [1], name: ['Ada'] }));

        registerNotebookScriptQuery(scriptData, 11, 'SELECT * FROM remote', execution, modifyNotebookScripts);
        expect(modifyNotebookScripts).toHaveBeenNthCalledWith(1, { type: REGISTER_QUERY, value: [7, 11] });
        await execution;
        await Promise.resolve();
        expect(modifyNotebookScripts).toHaveBeenNthCalledWith(2, {
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
        const modifyNotebookScripts = vi.fn();
        const execution = Promise.resolve(null);

        registerNotebookScriptQuery(scriptData, 12, 'SELECT * FROM remote', execution, modifyNotebookScripts);
        await execution;
        await Promise.resolve();
        expect(modifyNotebookScripts).toHaveBeenCalledTimes(1);
    });
});
