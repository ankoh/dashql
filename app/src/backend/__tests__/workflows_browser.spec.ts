import fs from 'fs';
import { init as initWASI, WASI } from '@wasmer/wasi';
import * as test from '../../test';
import * as duckdb from '@duckdb/duckdb-wasm';
import * as dashql from '@dashql/dashql-core/wasm';
import * as proto from '@dashql/dashql-proto';
import * as flatbuffers from 'flatbuffers';

import { jest } from '@jest/globals';
import { Parser } from '../wasm_parser_api';

const PARSER_MODULE_URL = new URL(
    '../../../../libs/dashql-parser/build/wasm/Release/dashql_parser.wasm',
    import.meta.url,
);
const CORE_MODULE_URL = new URL('../../../../libs/dashql-core/dist/wasm/dashql_core_bg.wasm', import.meta.url);

async function initParser(): Promise<Parser> {
    await initWASI();
    const wasi = new WASI({
        env: {},
        args: [],
    });
    const modBuffer = fs.readFileSync(PARSER_MODULE_URL);
    const mod = await WebAssembly.compile(modBuffer);
    const instance = await wasi.instantiate(mod, {});
    wasi.start();
    return new Parser(instance);
}

describe('Wasm Workflows', () => {
    let db: duckdb.AsyncDuckDB | null = null;

    beforeAll(async () => {
        db = test.DUCKDB_WASM;
    });

    it('hello workflows', async () => {
        const frontend = {} as any;
        frontend.beginBatchUpdate = jest.fn();
        frontend.endBatchUpdate = jest.fn();
        frontend.updateProgram = jest.fn();

        const moduleBuffer = fs.readFileSync(CORE_MODULE_URL);
        await dashql.default(moduleBuffer);

        const parser = await initParser();
        dashql.linkParser(parser);
        dashql.linkDuckDB(db);

        await dashql.workflowConfigureDefault();
        const session = await dashql.workflowCreateSession(frontend);
        await dashql.workflowUpdateProgram(session, 'create table foo as select 42');
        await dashql.workflowCloseSession(session);

        expect(frontend.beginBatchUpdate).toHaveBeenCalledWith(session);
        expect(frontend.endBatchUpdate).toHaveBeenCalledWith(session);
        expect(frontend.updateProgram).toHaveBeenCalled();

        const args = frontend.updateProgram.mock.calls[0];
        expect(args[0]).toEqual(session);
        expect(args[1].byteLength).toBeGreaterThan(0);

        const buffer = new flatbuffers.ByteBuffer(new Uint8Array(args[1]));
        const program = proto.Program.getRootAsProgram(buffer);
        expect(program.errorsLength()).toEqual(0);
        expect(program.statementsLength()).toEqual(1);
    });
});
