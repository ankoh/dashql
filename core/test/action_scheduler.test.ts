import { analyzer, model, actions, platform, ActionScheduler, utils } from '../src/index_node';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as proto from '@dashql/proto';
import * as path from 'path';
import Worker from 'web-worker';

import ActionStatus = proto.action.ActionStatusCode;
import ActionClass = model.ActionClass;
import ProgramActionType = proto.action.ProgramActionType;

const logger = new webdb.ConsoleLogger();

let analyzerBindings: analyzer.AnalyzerBindings;
let worker: Worker;
let db: webdb.AsyncWebDB;
let conn: webdb.AsyncWebDBConnection;

beforeAll(async () => {
    analyzerBindings = new analyzer.Analyzer({}, path.resolve(__dirname, '../src/analyzer/analyzer_wasm_node.wasm'));
    await analyzerBindings.init();
    worker = new Worker(path.resolve(__dirname, "../../webdb/dist/webdb_node_async.worker.js"));
    db = new webdb.AsyncWebDB(logger, worker);
});

beforeEach(async () => {
    try {
        await analyzerBindings.reset();
        await db.open(path.resolve(__dirname, "../../webdb/dist/webdb.wasm"));
        conn = await db.connect();
    } catch (e) {
        console.error(e);
    }
});

afterEach(async () => {
    await conn.disconnect();
    await db.reset();
});

afterAll(async () => {
    await db.terminate();
    worker.terminate();
});

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
        test('single table', async () => {
            const store = model.createStore();
            const plat = new platform.Platform(store, logger, db, analyzerBindings);
            await plat.init();

            const program = analyzerBindings.parseProgram('CREATE TABLE a AS SELECT 1');
            analyzerBindings.instantiateProgram();
            const plan = analyzerBindings.planProgram();
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
            expect(scheduler.actions[0].buffer.actionType()).toBe(ProgramActionType.CREATE_TABLE);
            expect(scheduler.actions[0].status).toBe(ActionStatus.NONE);

            const diff = new utils.NativeStack();
            const ctx = new actions.ActionContext(plat, plan!);

            const workLeft = await scheduler.executeFirst(ctx, diff);
            expect(workLeft).toBe(false);
            expect(scheduler.actions[0].status).toBe(ActionStatus.COMPLETED);
        });

        test('chain', async () => {
            const store = model.createStore();
            const plat = new platform.Platform(store, logger, db, analyzerBindings);
            await plat.init();

            const program = analyzerBindings.parseProgram(`
                LOAD weather_csv FROM http (
                    url = 'https://localhost/test'
                );
                EXTRACT weather FROM weather_csv USING CSV;
                VIZ weather USING LINE;
            `);
            analyzerBindings.instantiateProgram();
            const plan = analyzerBindings.planProgram();
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
            expect(scheduler.actions.map(a => a.buffer.actionType())).toEqual([
                ProgramActionType.LOAD_HTTP,
                ProgramActionType.EXTRACT_CSV,
                ProgramActionType.CREATE_VIZ,
            ]);
            expect(scheduler.actions.map(a => a.buffer.dependsOnArray())).toEqual([
                null,
                new Uint32Array([0]),
                new Uint32Array([1]),
            ]);
            expect(scheduler.actions.map(a => a.buffer.requiredForArray())).toEqual([
                new Uint32Array([1]),
                new Uint32Array([2]),
                null,
            ]);

            const ctx = new actions.ActionContext(plat, plan!);
            const diff = new utils.NativeStack();
            let workLeft = await scheduler.executeFirst(ctx, diff);
            expect(scheduler.actions[0].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(true);
            workLeft = await scheduler.execute(ctx, diff);
            expect(scheduler.actions[1].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(true);
            workLeft = await scheduler.execute(ctx, diff);
            expect(scheduler.actions[2].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(false);
        });

        test('tree', async () => {
            const store = model.createStore();
            const plat = new platform.Platform(store, logger, db, analyzerBindings);
            await plat.init();

            const program = analyzerBindings.parseProgram(`
                CREATE TABLE weather AS SELECT 1;
                VIZ weather USING TABLE;
                VIZ weather USING LINE;
            `);
            analyzerBindings.instantiateProgram();
            const plan = analyzerBindings.planProgram();
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

            const ctx = new actions.ActionContext(plat, plan!);
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

        test('independent', async () => {
            const store = model.createStore();
            const plat = new platform.Platform(store, logger, db, analyzerBindings);
            await plat.init();

            const program = analyzerBindings.parseProgram(`
                CREATE TABLE A AS SELECT 1;
                CREATE TABLE B AS SELECT 1;
                CREATE TABLE C AS SELECT 1;
            `);
            analyzerBindings.instantiateProgram();
            const plan = analyzerBindings.planProgram();
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
            expect(scheduler.actions.map(a => a.buffer.actionType())).toEqual([
                ProgramActionType.CREATE_TABLE,
                ProgramActionType.CREATE_TABLE,
                ProgramActionType.CREATE_TABLE,
            ]);
            expect(scheduler.actions.map(a => a.buffer.dependsOnArray())).toEqual([null, null, null]);
            expect(scheduler.actions.map(a => a.buffer.requiredForArray())).toEqual([null, null, null]);

            const ctx = new actions.ActionContext(plat, plan!);
            const diff = new utils.NativeStack();
            let workLeft = await scheduler.executeFirst(ctx, diff);
            expect(workLeft).toBe(true);
            workLeft = await scheduler.execute(ctx, diff);
            expect(workLeft).toBe(true);
            workLeft = await scheduler.execute(ctx, diff);
            expect(workLeft).toBe(false);
            expect(scheduler.actions[0].status).toBe(ActionStatus.COMPLETED);
            expect(scheduler.actions[1].status).toBe(ActionStatus.COMPLETED);
            expect(scheduler.actions[2].status).toBe(ActionStatus.COMPLETED);
        });
    });
});
