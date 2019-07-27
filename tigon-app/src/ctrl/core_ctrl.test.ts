import { CoreController } from './core_ctrl';
import * as fs from 'fs';
import * as path from 'path';
import TigonWeb from '../../public/lib/tigon_web';

// The core loader
let coreLoader: (args: any) => any;
// The shared core
let sharedCore: CoreController;

beforeAll(async () => {
    // Create the core ladder
    let modulePath = path.resolve(__dirname, '../../public/lib/tigon_web.wasm');
    let moduleBinary = await fs.promises.readFile(modulePath);
    coreLoader = (args: any) => {
        return TigonWeb({ ...args, wasmBinary: moduleBinary });
    };

    // Share a controller between multiple tests
    sharedCore = new CoreController(coreLoader);
    await sharedCore.init();
});

describe("controller/core", () => {
    test("runQuery 'SELECT 1;'", async () => {
        let session = await sharedCore.createSession();
        let result = await sharedCore.query(session, "SELECT 1;");

        result.destroy();
        await sharedCore.endSession();
    });
});
