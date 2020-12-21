import { DashQLCoreWasm, CORE_WASM_RUNTIME_STUBS, model } from '../src/index_node';
import * as path from 'path';

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm(CORE_WASM_RUNTIME_STUBS, path.resolve(__dirname, "../src/wasm/core_wasm_node.wasm"));
    await core.init();
});

describe('Action Scheduler', () => {
   describe('program actions', () => {
        test('select 1', async () => {
            const program = core.parseProgram("select 1");
            expect(program.buffer.statementsLength()).toBe(1);
            const plan = core.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(1);
        });
   });
});
