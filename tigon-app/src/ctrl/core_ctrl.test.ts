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

describe("controller/core", () => {
    describe("parseTQL", () => {
        test("SELECT 1;", async () => {
            let session = await sharedCore.createSession();
            let programBuffer = await sharedCore.parseTQL(session, "SELECT 1;");
            let program = programBuffer.getReader();
            let fmtBuffer = await sharedCore.formatTQLProgram(session, programBuffer.getData());
            let fmt = fmtBuffer.getReader();

            console.log(fmt.text());

            expect(program.statementsLength()).toEqual(1);

            fmtBuffer.release();
            programBuffer.release();
            await sharedCore.endSession(session);
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
