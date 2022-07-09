import fs from 'fs';
import { init as initWASI, WASI } from '@wasmer/wasi';
import * as flatbuffers from 'flatbuffers';
import * as proto from '@dashql/dashql-proto';

import { Parser } from '../wasm_parser_api';

const PARSER_MODULE_URL = new URL(
    '../../../../libs/dashql-parser/build/wasm/Release/dashql_parser.wasm',
    import.meta.url,
);
describe('Wasm Parser', () => {
    it('hello parser', async () => {
        await initWASI();
        const wasi = new WASI({
            env: {},
            args: [],
        });
        const parserModuleBuffer = fs.readFileSync(PARSER_MODULE_URL);
        const parserModule = await WebAssembly.compile(parserModuleBuffer);
        const parserInstance = await wasi.instantiate(parserModule, {});
        wasi.start();

        const parser = new Parser(parserInstance);
        const programData = parser.parse(`CREATE TABLE foo AS SELECT 42`);

        const programBuffer = new flatbuffers.ByteBuffer(programData.getData());
        const program = proto.Program.getRootAsProgram(programBuffer);
        expect(program.errorsLength()).toEqual(0);
        expect(program.statementsLength()).toEqual(1);

        programData.delete();
    });
});
