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
    expect(graph).toBeDefined();
    expect(graph).not.toBeNull();
    const count = graph!.programActionsLength();
    r.length = count;
    for (let i = 0; i < count; ++i) {
        const action = graph!.programActions(i)!;
        expect(action).toBeDefined();
        expect(action).not.toBeNull();
        expect(action.originStatement()).toEqual(i);
        expect(action.actionType()).not.toEqual(ProgramActionType.NONE);
        const stmt = plan.program.getStatement(i);
        const aid = model.buildActionID(i, model.ActionClass.ProgramAction);
        r[i] = actions.resolveProgramActionLogic(aid, action, stmt)!;
        expect(r[i]).not.toBeNull();
    }
    return r;
}

describe('Action Scheduler', () => {
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

            const workLeft = await scheduler.executeFirst(ctx, diff);
            expect(workLeft).toBe(false);
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
                VIZ weather USING LINE;
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
            expect(scheduler.actions.map((a) => a.buffer.dependsOnArray())).toEqual([
                null,
                new Uint32Array([0]),
                new Uint32Array([1]),
                new Uint32Array([2])
            ]);
            expect(scheduler.actions.map((a) => a.buffer.requiredForArray())).toEqual([
                new Uint32Array([1]),
                new Uint32Array([2]),
                new Uint32Array([3]),
                null
            ]);

            const ctx = new actions.ActionContext(platform, plan!);
            const diff = new utils.NativeStack();
            let workLeft = await scheduler.executeFirst(ctx, diff);
            expect(scheduler.actions[0].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(true);
            workLeft = await scheduler.execute(ctx, diff);
            expect(scheduler.actions[1].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(true);
            workLeft = await scheduler.execute(ctx, diff);
            expect(scheduler.actions[2].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(true);
            workLeft = await scheduler.execute(ctx, diff);
            expect(scheduler.actions[3].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(false);
        });

        test('tree', async () => {
            const platformMock = new PlatformMock();
            const platform = platformMock.getInstance();

            const program = core.parseProgram(`
                SELECT 1 INTO weather;
                VIZ weather USING TABLE;
                VIZ weather USING LINE;
            `);
            const plan = core.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(program.buffer.statementsLength()).toBe(3);
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(3);

            const logic = resolveProgramActionLogic(plan!);
            const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
            const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt);
            scheduler.prepare(logic);
            scheduler.actions.forEach((a, i) => {
                expect(a.actionClass).toBe(ActionClass.ProgramAction);
                expect(a.buffer.originStatement()).toBe(i);
                expect(a.status).toBe(ActionStatus.NONE);
            });
            expect(scheduler.actions.map((a) => a.buffer.actionType())).toEqual([
                ProgramActionType.TABLE_CREATE,
                ProgramActionType.VIZ_CREATE,
                ProgramActionType.VIZ_CREATE
            ]);
            expect(scheduler.actions.map((a) => a.buffer.dependsOnArray())).toEqual([
                null,
                new Uint32Array([0]),
                new Uint32Array([0]),
            ]);
            expect(scheduler.actions.map((a) => a.buffer.requiredForArray())).toEqual([
                new Uint32Array([1, 2]),
                null,
                null
            ]);

            const ctx = new actions.ActionContext(platform, plan!);
            const diff = new utils.NativeStack();
            let workLeft = await scheduler.executeFirst(ctx, diff);
            expect(scheduler.actions[0].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(true);
            workLeft = await scheduler.execute(ctx, diff);
            expect(workLeft).toBe(true);
            workLeft = await scheduler.execute(ctx, diff);
            expect(scheduler.actions[1].status).toBe(ActionStatus.COMPLETED);
            expect(scheduler.actions[2].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(false);
        });
    });
});
