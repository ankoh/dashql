import { describe, expect, it, vi } from 'vitest';

import { REGISTER_QUERY, type ScriptData } from '../scripts/notebook_scripts.js';
import { registerNotebookScriptQuery } from './rerun_query.js';

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
