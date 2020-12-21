import { DashQLCoreWasm, CORE_WASM_RUNTIME_STUBS, model, actions, ActionScheduler, utils } from '../src/index_node';
import * as path from 'path';
import * as proto from '@dashql/proto';
import { PlatformMock } from './mocks';

import ActionStatus = proto.action.ActionStatusCode;
import ActionClass = model.ActionClass;
import ProgramActionType = proto.action.ProgramActionType;

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm(CORE_WASM_RUNTIME_STUBS, path.resolve(__dirname, '../src/wasm/core_wasm_node.wasm'));
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
    describe('setup actions', () => {});

    describe('program actions', () => {
        test('select 1', async () => {
            const platformMock = new PlatformMock();
            const platform = platformMock.getInstance();

            const program = core.parseProgram('select 1');
            const plan = core.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(program.buffer.statementsLength()).toBe(1);
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(1);

            const logic = resolveProgramActionLogic(plan!);
            const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
            const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt);
            scheduler.reset(logic);
            expect(scheduler.actions.length).toBe(1);
            expect(scheduler.actions[0].actionClass).toBe(ActionClass.ProgramAction);
            expect(scheduler.actions[0].buffer.actionType()).toBe(ProgramActionType.VIZ_CREATE); // XXX
            expect(scheduler.actions[0].status).toBe(ActionStatus.NONE);

            const diff = new utils.NativeStack();
            const ctx = new actions.ActionContext(platform, plan!);

            const cont = await scheduler.executeFirst(ctx, diff);
            expect(cont).toBe(false);
            expect(scheduler.actions[0].status).toBe(ActionStatus.COMPLETED);
        });
    });
});
