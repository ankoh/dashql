import fs from 'fs';
import { WASI } from 'wasi';

const PARSER_MODULE_URL = new URL(
    '../../../../libs/dashql-parser/build/wasm/Release/dashql_parser.wasm',
    import.meta.url,
);

describe('Wasm Parser', () => {
    it('hello parser', async () => {
        const buf = fs.readFileSync(PARSER_MODULE_URL);
        const wasi = new WASI();
        const imports = { wasi_snapshot_preview1: wasi.wasiImport };
        const parser = await WebAssembly.instantiate(buf, imports);
        const parserExports = parser.instance.exports;
        expect(parserExports['dashql_result_new']).toBeDefined();
        expect(parserExports['dashql_result_delete']).toBeDefined();
        expect(parserExports['dashql_parse']).toBeDefined();
    });
});
