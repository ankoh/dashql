import { Parser } from '../backend/wasm_parser_api';
import { init as initWASI, WASI } from '@wasmer/wasi';
import { DUCKDB_WASM } from './duckdb_wasm_setup';
import fs from 'fs';
import * as dashql from '@dashql/dashql-core/dist/wasm';

const PARSER_MODULE_URL = new URL('../../../libs/dashql-parser/build/wasm/Release/dashql_parser.wasm', import.meta.url);
const CORE_MODULE_URL = new URL('../../../libs/dashql-core/dist/wasm/dashql_core_bg.wasm', import.meta.url);

export async function initParser(): Promise<Parser> {
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

export let DASHQL_PARSER: Parser | null = null;

beforeAll(async () => {
    DASHQL_PARSER = await initParser();
    await dashql.init(fs.readFileSync(CORE_MODULE_URL));
    dashql.linkParser(DASHQL_PARSER);
    dashql.linkDuckDB(DUCKDB_WASM);
    await dashql.workflowConfigureDefault();
});
