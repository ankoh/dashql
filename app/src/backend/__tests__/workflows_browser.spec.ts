import fs from 'fs';
import { init as initWASI, WASI } from '@wasmer/wasi';
import * as dashql from '@dashql/dashql-core/wasm';
import * as proto from '@dashql/dashql-proto';
import * as flatbuffers from 'flatbuffers';

import { jest } from '@jest/globals';

const encoder = new TextEncoder();
const PARSER_MODULE_URL = new URL(
    '../../../../libs/dashql-parser/build/wasm/Release/dashql_parser.wasm',
    import.meta.url,
);
const CORE_MODULE_URL = new URL('../../../../libs/dashql-core/dist/wasm/dashql_core_bg.wasm', import.meta.url);

// async function initParser(): Promise<Parser> {
//     await initWASI();
//     const wasi = new WASI({
//         env: {},
//         args: [],
//     });
//     const modBuffer = fs.readFileSync(PARSER_MODULE_URL);
//     const mod = await WebAssembly.compile(modBuffer);
//     const instance = await wasi.instantiate(mod, {});
//     wasi.start();
//     return new Parser(instance);
// }

describe('Wasm Workflows', () => {
    it('hello workflows', async () => {
        const frontend = {} as any;
        frontend.beginBatchUpdate = jest.fn();
        frontend.endBatchUpdate = jest.fn();
        frontend.updateProgram = jest.fn();

        const moduleBuffer = fs.readFileSync(CORE_MODULE_URL);
        await dashql.default(moduleBuffer);

        const session = await dashql.workflowCreateSession(frontend);
        // await dashql.workflowUpdateProgram(session, 'create table foo as select 42');
        // await dashql.workflowCloseSession(session);

        // expect(frontend.beginBatchUpdate).toHaveBeenCalledWith(session);
        // expect(frontend.endBatchUpdate).toHaveBeenCalledWith(session);
        // expect(frontend.updateProgram).toHaveBeenCalled();
    });
});
