import fs from 'fs';
import { WASI } from 'wasi';
import * as flatbuffers from 'flatbuffers';
import * as proto from '@dashql/dashql-proto';

const PARSER_MODULE_URL = new URL(
    '../../../../libs/dashql-parser/build/wasm/Release/dashql_parser.wasm',
    import.meta.url,
);
const encoder = new TextEncoder();

describe('Wasm Parser', () => {
    it('hello parser', async () => {
        const wasi = new WASI();
        const parserModuleBuffer = fs.readFileSync(PARSER_MODULE_URL);
        const parserModule = await WebAssembly.compile(parserModuleBuffer);
        const parserInstance = await WebAssembly.instantiate(parserModule, {
            wasi_snapshot_preview1: wasi.wasiImport,
        });
        wasi.start(parserInstance);

        const parserExports = parserInstance.exports;
        expect(parserExports).toBeDefined();
        const parserMemory = parserExports['memory'] as unknown as WebAssembly.Memory;
        expect(parserMemory).toBeDefined();
        const parserHeapU8 = new Uint8Array(parserMemory.buffer);
        expect(parserHeapU8).toBeDefined();
        const parserHeapU32 = new Uint32Array(parserMemory.buffer);

        const dashql_new_result = parserExports['dashql_new_result'] as () => number;
        const dashql_new_string = parserExports['dashql_new_string'] as (n: number) => number;
        const dashql_delete_result = parserExports['dashql_delete_result'] as (ptr: number) => void;
        const dashql_delete_string = parserExports['dashql_delete_string'] as (ptr: number) => void;
        const dashql_parse = parserExports['dashql_parse'] as (
            result: number,
            text: number,
            textLength: number,
        ) => void;
        expect(dashql_new_result).toBeDefined();
        expect(dashql_new_string).toBeDefined();
        expect(dashql_delete_result).toBeDefined();
        expect(dashql_delete_string).toBeDefined();
        expect(dashql_parse).toBeDefined();

        const textEncoded = encoder.encode(`
            CREATE TABLE foo AS SELECT 42
        `);
        const textPtr = dashql_new_string(textEncoded.length);
        const resultPtr = dashql_new_result();
        parserHeapU8.subarray(textPtr, textPtr + textEncoded.length).set(textEncoded);
        dashql_parse(resultPtr, textPtr, textEncoded.length);

        const resultPtrU32 = resultPtr / 4;
        const statusCode = parserHeapU32[resultPtrU32];
        const dataLength = parserHeapU32[resultPtrU32 + 1];
        const dataPtr = parserHeapU32[resultPtrU32 + 2];
        expect(statusCode).toEqual(0);
        expect(dataLength).toBeGreaterThan(0);
        expect(dataPtr).toBeGreaterThan(0);
        const programBuffer = new flatbuffers.ByteBuffer(parserHeapU8.subarray(dataPtr, dataPtr + dataLength));
        const program = proto.Program.getRootAsProgram(programBuffer);
        expect(program.errorsLength()).toEqual(0);
        expect(program.statementsLength()).toEqual(1);

        dashql_delete_string(textPtr);
        dashql_delete_result(resultPtr);
    });
});
