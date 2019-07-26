import { CoreController } from './core_ctrl';
import * as fs from 'fs';
import * as path from 'path';
import TigonWeb from '../../public/lib/tigon_web';

let wasm = fs.readFileSync(path.resolve(__dirname, '../../public/lib/tigon_web.wasm'));

function wasmLoader(args: any): any {
    return TigonWeb({ ...args, wasmBinary: wasm });
}

describe("controller/core", () => {
    test("init succeeds", async () => {
        try {
            let core = new CoreController(wasmLoader);
            await core.init();
        } catch (e) {
            fail(e);
        }
    });

    test("runQuery 'SELECT 1;'", async () => {
        let core = new CoreController(wasmLoader);
        await core.init();

        let result = await core.runQuery("SELECT 1;");

        result.destroy();
    });
});
