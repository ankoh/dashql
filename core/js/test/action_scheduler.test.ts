import { DashQLCoreWasm, CORE_WASM_RUNTIME_STUBS } from '../src/index_node';
import * as path from 'path';

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm(CORE_WASM_RUNTIME_STUBS, path.resolve(__dirname, "../src/wasm/core_wasm_node.wasm"));
    await core.init();
});

describe('Action Planner', () => {
   describe('planning', () => {
       test('select 1', async () => {
           const _program = core.parseProgram("select 1");
           const plan = core.planProgram();
           const action_graph = plan!.action_graph!;

           expect(action_graph.setupActionsLength()).toBe(0);
           expect(action_graph.programActionsLength()).toBe(1);
       });
   });
});
