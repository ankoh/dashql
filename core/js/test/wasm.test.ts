import { DashQLCoreWasm, CORE_WASM_RUNTIME_STUBS } from '../src/index_node';
import * as path from 'path';

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm(CORE_WASM_RUNTIME_STUBS, path.resolve(__dirname, "../src/wasm/core_wasm_node.wasm"));
    await core.init();
});

describe('Runtime', () => {
   describe('ping', () => {
       test('pong', async () => {
           const r = core.ping();
           expect(r).toEqual(42);
       });
   });
})
