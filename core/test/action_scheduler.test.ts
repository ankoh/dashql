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

beforeEach(async () => {
    core.resetSession();
})

function resolveProgramActionLogic(plan: model.Plan) {
    let r: actions.ActionLogic<proto.action.ProgramAction>[] = [];
    const graph = plan.action_graph;
    if (!graph) return r;
    const count = graph.programActionsLength();
    r.length = count;
    for (let i = 0; i < count; ++i) {
        const action = graph.programActions(i)!;
        const stmt = plan.program.getStatement(i);
        const aid = model.buildActionID(i, model.ActionClass.ProgramAction);
        r[i] = actions.resolveProgramActionLogic(aid, action, stmt)!;
    }
    return r;
}

describe('Action Scheduler', () => {
    describe('setup actions', () => {});

    describe('program actions', () => {

        test('single select', async () => {
            const platformMock = new PlatformMock();
            const platform = platformMock.getInstance();

            const program = core.parseProgram('SELECT 1 INTO a');
            const plan = core.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(program.buffer.statementsLength()).toBe(1);
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(1);

            const logic = resolveProgramActionLogic(plan!);
            const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
            const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt);
            scheduler.prepare(logic);
            expect(scheduler.actions.length).toBe(1);
            expect(scheduler.actions[0].actionClass).toBe(ActionClass.ProgramAction);
            expect(scheduler.actions[0].buffer.actionType()).toBe(ProgramActionType.TABLE_CREATE);
            expect(scheduler.actions[0].status).toBe(ActionStatus.NONE);

            const diff = new utils.NativeStack();
            const ctx = new actions.ActionContext(platform, plan!);

            const cont = await scheduler.executeFirst(ctx, diff);
            expect(cont).toBe(false);
            expect(scheduler.actions[0].status).toBe(ActionStatus.COMPLETED);
        });


        test('chain', async () => {
            const platformMock = new PlatformMock();
            const platform = platformMock.getInstance();

            const program = core.parseProgram(`
                DECLARE PARAMETER country TYPE TEXT;
                LOAD weather_csv FROM http (
                    url = format('https://cdn.dashql.com/demo/weather/%s', global.country)
                );
                EXTRACT weather FROM weather_csv USING CSV;
                VIZ weather_avg USING LINE;
            `);
            const plan = core.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(program.buffer.statementsLength()).toBe(4);
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(4);

            const logic = resolveProgramActionLogic(plan!);
            const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
            const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt);
            scheduler.prepare(logic);
            expect(scheduler.actions.length).toBe(4);
            scheduler.actions.forEach((a, i) => {
                expect(a.actionClass).toBe(ActionClass.ProgramAction);
                expect(a.buffer.originStatement()).toBe(i);
                expect(a.status).toBe(ActionStatus.NONE);
            });
            expect(scheduler.actions.map((a) => a.buffer.actionType())).toEqual([
                ProgramActionType.PARAMETER,
                ProgramActionType.LOAD_HTTP,
                ProgramActionType.EXTRACT_CSV,
                ProgramActionType.VIZ_CREATE
            ]);
        });
    });
});
