import { DashQLCoreWasm, CORE_WASM_RUNTIME_STUBS, model, actions, ActionScheduler, utils } from '../src/index_node';
import * as path from 'path';
import * as proto from '@dashql/proto';
import { PlatformMock } from './mocks';

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm(CORE_WASM_RUNTIME_STUBS, path.resolve(__dirname, "../src/wasm/core_wasm_node.wasm"));
    await core.init();
});

function resolveProgramActionLogic(plan: model.Plan) {
    return plan.mapProgramActions((i, a) => {
        const aid = model.buildActionID(i, model.ActionClass.ProgramAction);
        const stmtId = a.originStatement();
        const stmt = plan.program.getStatement(stmtId);
        return actions.resolveProgramActionLogic(aid, a, stmt)!;
    });
}

describe('Action Scheduler', () => {
   describe('setup actions', () => {
   });

   describe('program actions', () => {
        test('hello scheduler', async () => {
            const platformMock = new PlatformMock();
            const platform = platformMock.getInstance();

            const program = core.parseProgram("select 1");
            const plan = core.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(program.buffer.statementsLength()).toBe(1);
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(1);

            let logic = resolveProgramActionLogic(plan!);
            let interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
            let scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt);
            scheduler.reset(logic);

            let diff = new utils.NativeStack();
            let ctx = new actions.ActionContext(platform, plan!);
            await scheduler.execute(ctx, diff);
        });
   });
});
