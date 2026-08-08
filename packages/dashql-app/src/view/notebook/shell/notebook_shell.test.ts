import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as core from '../../../core/index.js';
import { analyzeScript } from '../../editor/dashql_processor.js';
import { ShellInputState, classifyShellInput, getShellInputError } from './notebook_shell.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

describe('Notebook Shell input', () => {
    let dql: core.DashQL;
    let catalog: core.DashQLCatalog;
    let script: core.DashQLScript;

    beforeAll(async () => {
        dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        catalog = dql.createCatalog();
        script = dql.createScript(catalog);
    });

    afterAll(() => {
        script.destroy();
        catalog.destroy();
    });

    function classify(text: string): { state: ShellInputState; error: string | null } {
        script.replaceText(text);
        const buffers = analyzeScript(script);
        try {
            return {
                state: classifyShellInput(text, buffers),
                error: getShellInputError(text, buffers),
            };
        } finally {
            buffers.destroy(buffers);
        }
    }

    it('continues incomplete input and executes a terminated statement', () => {
        expect(classify('').state).toBe(ShellInputState.Empty);
        expect(classify('select 1').state).toBe(ShellInputState.Incomplete);
        expect(classify('select\n1;').state).toBe(ShellInputState.Complete);
    });

    it('does not execute semicolons inside strings or comments', () => {
        expect(classify("select ';'").state).toBe(ShellInputState.Incomplete);
        expect(classify('select 1 -- ;').state).toBe(ShellInputState.Incomplete);
        expect(classify("select ';';").state).toBe(ShellInputState.Complete);
    });

    it('rejects multiple statements', () => {
        expect(classify('select 1; select 2;').state).toBe(ShellInputState.Multiple);
    });

    it('surfaces parser errors while typing', () => {
        const result = classify('select (1;');
        expect(result.state).toBe(ShellInputState.Incomplete);
        expect(result.error).not.toBeNull();
    });

    it('handles non-ASCII text without confusing byte spans', () => {
        expect(classify("select 'Grüße';").state).toBe(ShellInputState.Complete);
    });
});
