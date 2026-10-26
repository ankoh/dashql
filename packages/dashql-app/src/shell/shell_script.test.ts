import * as dashql from '@ankoh/dashql-core';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { splitShellScript } from './shell_script.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

afterAll(() => core.resetUnsafe());

describe('Shell script splitting', () => {
    let catalog: dashql.DashQLCatalog;

    beforeEach(() => {
        catalog = core.createCatalog();
    });

    afterEach(() => {
        catalog.destroy();
    });

    it('splits statements and terminates each one', () => {
        expect(splitShellScript(core, catalog, 'select 1; select\n  2;\n\nselect 3')).toEqual([
            'select 1;',
            'select\n  2;',
            'select 3;',
        ]);
    });

    it('keeps dot commands as their own prompts', () => {
        expect(splitShellScript(core, catalog, 'select 1;\n  .output table  \nselect 2;\n.timer on')).toEqual([
            'select 1;',
            '.output table',
            'select 2;',
            '.timer on',
        ]);
    });

    it('slices statements after multi-byte characters', () => {
        expect(splitShellScript(core, catalog, 'select \'🦆\'; select \'ü\';')).toEqual([
            'select \'🦆\';',
            'select \'ü\';',
        ]);
    });

    it('keeps SQL that does not parse as a single prompt', () => {
        expect(splitShellScript(core, catalog, 'select from from; select 2;')).toEqual(['select from from; select 2;']);
    });

    it('ignores empty scripts', () => {
        expect(splitShellScript(core, catalog, ' \n\n ')).toEqual([]);
    });
});
