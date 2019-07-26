import { CoreController } from './core_ctrl';
import * as fs from 'fs';
import * as path from 'path';
import TigonWeb from '../../public/lib/tigon_web';

// The core loader
let coreLoader: (args: any) => any;
// The shared core
let sharedCore: CoreController;

beforeAll(async () => {
    // Create the core laoder
    let modulePath = path.resolve(__dirname, '../../public/lib/tigon_web.wasm');
    let moduleBinary = await fs.promises.readFile(modulePath);
    coreLoader = (args: any) => {
        return TigonWeb({ ...args, wasmBinary: moduleBinary });
    };

    // Share a controller betwee multiple tests
    sharedCore = new CoreController(coreLoader);
    await sharedCore.init();
});

describe("controller/core", () => {
    test("runQuery 'SELECT 1;'", async () => {
        let result = await sharedCore.runQuery("SELECT 1;");
        result.destroy();
    });
});
