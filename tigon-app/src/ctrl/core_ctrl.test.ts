import { CoreController } from './core_ctrl';
import * as fs from 'fs';
import * as path from 'path';
import TigonCore from '../../public/lib/tigon_core';

// The core loader
let coreLoader: (args: any) => any;
// The shared core
let sharedCore: CoreController;

beforeAll(async () => {
    // Create the core ladder
    let modulePath = path.resolve(__dirname, '../../public/lib/tigon_core.wasm');
    let moduleBinary = await fs.promises.readFile(modulePath);
    coreLoader = (args: any) => {
        return TigonCore({ ...args, wasmBinary: moduleBinary });
    };

    // Share a controller between multiple tests
    sharedCore = new CoreController(coreLoader);
    await sharedCore.init();
});

let test_tql_parser_id = 0;

// Test a tql program
function test_tql_parser(text: string, expected: any) {
    test("test_" + test_tql_parser_id++, async () => {
        let session = await sharedCore.createSession();
        let program = await sharedCore.parseTQL(session, text);
        let fmt = await sharedCore.formatTQLProgram(session, program.getData());
        expect(JSON.parse(fmt.getReader().text() || "")).toEqual(expected);
        fmt.release();
        program.release();
        await sharedCore.endSession(session);
    });
}

describe("controller/core", () => {
    describe("parseTQL", () => {
        test_tql_parser("", {
            "statements_type": [],
            "statements": []
        });

        test_tql_parser(`
            SELECT 1;
        `, {
            "statements_type": [ "TQLQueryStatement" ],
            "statements": [
                { "query_text": "SELECT 1" }
            ]
        });

        test_tql_parser(`
            SELECT 1;
            SELECT 1 + 2;
        `, {
            "statements_type": [ "TQLQueryStatement", "TQLQueryStatement" ],
            "statements": [
                { "query_text": "SELECT 1" },
                { "query_text": "SELECT 1 + 2" }
            ]
        });
    });

    describe("runQuery", () => {
        test("SELECT 1;", async () => {
            let session = await sharedCore.createSession();
            let result = await sharedCore.runQuery(session, "SELECT 1;");

            result.release();
            await sharedCore.endSession(session);
        });
    });
});
