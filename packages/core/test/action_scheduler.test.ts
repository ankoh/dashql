import { model, actions, platform, ActionScheduler, utils, analyzer, jmespath } from '../src';
import { HTTPMock } from './http_mock';

import * as proto from '@dashql/proto';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';

import ActionStatus = proto.action.ActionStatusCode;
import ActionClass = proto.action.ActionClass;
import ProgramActionType = proto.action.ProgramActionType;

export function testActionScheduler(
    db: () => duckdb.AsyncDuckDB,
    az: () => analyzer.AnalyzerBindings,
    jp: () => jmespath.JMESPathBindings,
): void {
    let httpMock: HTTPMock | null = null;

    beforeEach(async () => {});

    afterEach(async () => {
        await db().reset();
        await az().reset();

        if (httpMock != null) {
            httpMock.reset();
            httpMock = null;
        }
    });

    function resolveProgramActionLogic(plan: model.Plan) {
        const r: actions.ActionLogic<proto.action.ProgramAction>[] = [];
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
            const aid = model.buildActionHandle(i, ActionClass.PROGRAM_ACTION);
            r[i] = actions.resolveProgramActionLogic(aid, action, stmt)!;
            expect(r[i]).not.toBeNull();
        }
        return r;
    }

    const IGNORE_ACTION_UPDATES = (logic: model.ActionUpdate[]) => {};

    describe('Action Scheduler', () => {
        describe('program actions', () => {
            it('single table', async () => {
                const store = model.createStore();
                const plat = new platform.Platform(store, db().logger, db(), az(), async () => jp());
                await plat.init();

                const program = az().parseProgram('CREATE TABLE a AS SELECT 1');
                az().instantiateProgram();
                const plan = az().planProgram();
                const graph = plan!.buffer.actionGraph()!;
                const ctx = new actions.ActionContext(plat, plan!);
                expect(program.buffer.statementsLength()).toBe(1);
                expect(graph.setupActionsLength()).toBe(0);
                expect(graph.programActionsLength()).toBe(1);

                const logic = resolveProgramActionLogic(plan!);
                const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
                const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt, IGNORE_ACTION_UPDATES);
                scheduler.prepare(ctx, logic, []);
                expect(scheduler.actions.length).toBe(1);
                expect(scheduler.actions[0].actionClass).toBe(ActionClass.PROGRAM_ACTION);
                expect(scheduler.actions[0].buffer.actionType()).toBe(ProgramActionType.CREATE_TABLE);
                expect(scheduler.actions[0].status).toBe(ActionStatus.SKIPPED);

                const diff = new utils.NativeStack();
                const workLeft = await scheduler.executeFirst(ctx, diff);
                expect(workLeft).toBe(false);
                expect(scheduler.actions[0].status).toBe(ActionStatus.SKIPPED);
            });

            it('tree', async () => {
                const store = model.createStore();
                const plat = new platform.Platform(store, db().logger, db(), az(), async () => jp());
                await plat.init();

                const program = az().parseProgram(`
                    CREATE TABLE weather AS SELECT 1;
                    VIZ weather USING TABLE;
                    VIZ weather USING TABLE;
                `);
                az().instantiateProgram();
                const plan = az().planProgram();
                const graph = plan!.buffer.actionGraph()!;
                const ctx = new actions.ActionContext(plat, plan!);
                expect(program.buffer.statementsLength()).toBe(3);
                expect(graph.setupActionsLength()).toBe(0);
                expect(graph.programActionsLength()).toBe(3);

                const logic = resolveProgramActionLogic(plan!);
                const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
                const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt, IGNORE_ACTION_UPDATES);
                scheduler.prepare(ctx, logic, []);
                scheduler.actions.forEach((a, i) => {
                    expect(a.actionClass).toBe(ActionClass.PROGRAM_ACTION);
                    expect(a.buffer.originStatement()).toBe(i);
                    expect(a.status).toBe(ActionStatus.PENDING);
                });
                expect(scheduler.actions.map(a => a.buffer.actionType())).toEqual([
                    ProgramActionType.CREATE_TABLE,
                    ProgramActionType.CREATE_VIZ,
                    ProgramActionType.CREATE_VIZ,
                ]);
                expect(scheduler.actions.map(a => a.buffer.dependsOnArray())).toEqual([
                    null,
                    new Uint32Array([0]),
                    new Uint32Array([0]),
                ]);
                expect(scheduler.actions.map(a => a.buffer.requiredForArray())).toEqual([
                    new Uint32Array([1, 2]),
                    null,
                    null,
                ]);

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

            it('independent', async () => {
                const store = model.createStore();
                const plat = new platform.Platform(store, db().logger, db(), az(), async () => jp());
                await plat.init();

                const program = az().parseProgram(`
                    CREATE TABLE A AS SELECT 1;
                    CREATE TABLE B AS SELECT 1;
                    CREATE TABLE C AS SELECT 1;
                `);
                az().instantiateProgram();
                const plan = az().planProgram();
                const graph = plan!.buffer.actionGraph()!;
                const ctx = new actions.ActionContext(plat, plan!);
                expect(program.buffer.statementsLength()).toBe(3);
                expect(graph.setupActionsLength()).toBe(0);
                expect(graph.programActionsLength()).toBe(3);

                const logic = resolveProgramActionLogic(plan!);
                const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
                const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt, IGNORE_ACTION_UPDATES);
                scheduler.prepare(ctx, logic, []);
                scheduler.actions.forEach((a, i) => {
                    expect(a.actionClass).toBe(ActionClass.PROGRAM_ACTION);
                    expect(a.buffer.originStatement()).toBe(i);
                    expect(a.status).toBe(ActionStatus.SKIPPED);
                });
                expect(scheduler.actions.map(a => a.buffer.actionType())).toEqual([
                    ProgramActionType.CREATE_TABLE,
                    ProgramActionType.CREATE_TABLE,
                    ProgramActionType.CREATE_TABLE,
                ]);
                expect(scheduler.actions.map(a => a.buffer.dependsOnArray())).toEqual([null, null, null]);
                expect(scheduler.actions.map(a => a.buffer.requiredForArray())).toEqual([null, null, null]);

                const diff = new utils.NativeStack();
                const workLeft = await scheduler.executeFirst(ctx, diff);
                expect(workLeft).toBe(false);
                expect(scheduler.actions[0].status).toBe(ActionStatus.SKIPPED);
                expect(scheduler.actions[1].status).toBe(ActionStatus.SKIPPED);
                expect(scheduler.actions[2].status).toBe(ActionStatus.SKIPPED);
            });
        });
    });
}
