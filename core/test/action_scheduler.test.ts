import { DashQLCoreWasm, CORE_WASM_RUNTIME_STUBS, model, actions, ActionScheduler, utils } from '../src/index_node';
import * as path from 'path';
import * as proto from '@dashql/proto';
import { flatbuffers } from 'flatbuffers';
import { PlatformMock } from './mocks';

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm(CORE_WASM_RUNTIME_STUBS, path.resolve(__dirname, "../src/wasm/core_wasm_node.wasm"));
    await core.init();
});

describe('Action Scheduler', () => {
   describe('setup actions', () => {
   });

   describe('program actions', () => {
        test('hello scheduler', async () => {
            const platformMock = new PlatformMock();
            const platform = platformMock.getInstance();

            const program = core.parseProgram("select 1");
            expect(program.buffer.statementsLength()).toBe(1);
            const plan = core.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(1);

            let logic = plan!.mapProgramActions((i, a) => {
                const aid = model.buildActionID(i, model.ActionClass.ProgramAction);
                const stmtId = a.originStatement();
                const stmt = program.getStatement(stmtId);
                return actions.resolveProgramActionLogic(aid, a, stmt)!;
            });

            let interruptFunc: () => void;
            let interruptPromise = new Promise((resolve: (value: any) => void, _reject: (reason?: void) => void) => {
                interruptFunc = () => resolve(null);
            });

            let scheduler = new ActionScheduler<proto.action.ProgramAction>(interruptPromise);
            scheduler.reset(logic);

            let diff = new utils.NativeStack();
            let ctx = new actions.ActionContext(platform, plan!);
            await scheduler.execute(ctx, diff);
        });
   });
});
