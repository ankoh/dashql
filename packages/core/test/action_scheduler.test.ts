import { analyzer, model, actions, platform, ActionScheduler, utils } from '../src';
import { Analyzer } from '../src/index_browser';
import * as webdb from '@dashql/webdb/dist/webdb.module.js';
import * as proto from '@dashql/proto';

import ActionStatus = proto.action.ActionStatusCode;
import ActionClass = proto.action.ActionClass;
import ProgramActionType = proto.action.ProgramActionType;

const logger = new webdb.VoidLogger();

let az: analyzer.AnalyzerBindings;
let worker: Worker;
let db: webdb.parallel.AsyncWebDB;
let conn: webdb.parallel.AsyncWebDBConnection;

beforeAll(async () => {
    az = new Analyzer({}, '/static/analyzer_wasm.wasm');
    await az.init();
    worker = new Worker('/static/webdb-browser-parallel.worker.js');
    db = new webdb.parallel.AsyncWebDB(logger, worker);
});

beforeEach(async () => {
    try {
        await az.reset();
        await db.open('/static/webdb.wasm');
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
        const aid = model.buildActionHandle(i, ActionClass.PROGRAM_ACTION);
        r[i] = actions.resolveProgramActionLogic(aid, action, stmt)!;
        expect(r[i]).not.toBeNull();
    }
    return r;
}

describe('Action Scheduler', () => {
    describe('program actions', () => {
        it('single table', async () => {
            const store = model.createStore();
            const plat = new platform.Platform(store, logger, db, az);
            await plat.init();

            const program = az.parseProgram('CREATE TABLE a AS SELECT 1');
            az.instantiateProgram();
            const plan = az.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(program.buffer.statementsLength()).toBe(1);
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(1);

            const logic = resolveProgramActionLogic(plan!);
            const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
            const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt);
            scheduler.prepare(logic);
            expect(scheduler.actions.length).toBe(1);
            expect(scheduler.actions[0].actionClass).toBe(ActionClass.PROGRAM_ACTION);
            expect(scheduler.actions[0].buffer.actionType()).toBe(ProgramActionType.CREATE_TABLE);
            expect(scheduler.actions[0].status).toBe(ActionStatus.NONE);

            const diff = new utils.NativeStack();
            const ctx = new actions.ActionContext(plat, plan!);

            const workLeft = await scheduler.executeFirst(ctx, diff);
            expect(workLeft).toBe(false);
            expect(scheduler.actions[0].status).toBe(ActionStatus.COMPLETED);
        });

        it('chain', async () => {
            const store = model.createStore();
            const plat = new platform.Platform(store, logger, db, az);
            await plat.init();

            const program = az.parseProgram(`
                LOAD weather_csv FROM http (
                    url = 'https://localhost/test'
                );
                EXTRACT weather FROM weather_csv USING CSV;
            `);
            az.instantiateProgram();
            const plan = az.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(program.buffer.statementsLength()).toBe(2);
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(2);

            const logic = resolveProgramActionLogic(plan!);
            const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
            const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt);
            scheduler.prepare(logic);
            scheduler.actions.forEach((a, i) => {
                expect(a.actionClass).toBe(ActionClass.PROGRAM_ACTION);
                expect(a.buffer.originStatement()).toBe(i);
                expect(a.status).toBe(ActionStatus.NONE);
            });
            expect(scheduler.actions.map(a => a.buffer.actionType())).toEqual([
                ProgramActionType.LOAD_HTTP,
                ProgramActionType.EXTRACT_CSV,
            ]);
            expect(scheduler.actions.map(a => a.buffer.dependsOnArray())).toEqual([null, new Uint32Array([0])]);
            expect(scheduler.actions.map(a => a.buffer.requiredForArray())).toEqual([new Uint32Array([1]), null]);

            const ctx = new actions.ActionContext(plat, plan!);
            const diff = new utils.NativeStack();
            let workLeft = await scheduler.executeFirst(ctx, diff);
            expect(scheduler.actions[0].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(true);
            workLeft = await scheduler.execute(ctx, diff);
            expect(scheduler.actions[1].status).toBe(ActionStatus.COMPLETED);
            expect(workLeft).toBe(false);
        });

        it('tree', async () => {
            const store = model.createStore();
            const plat = new platform.Platform(store, logger, db, az);
            await plat.init();

            const program = az.parseProgram(`
                CREATE TABLE weather AS SELECT 1;
                VIZ weather USING TABLE;
                VIZ weather USING TABLE;
            `);
            az.instantiateProgram();
            const plan = az.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(program.buffer.statementsLength()).toBe(3);
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(3);

            const logic = resolveProgramActionLogic(plan!);
            const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
            const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt);
            scheduler.prepare(logic);
            scheduler.actions.forEach((a, i) => {
                expect(a.actionClass).toBe(ActionClass.PROGRAM_ACTION);
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

        it('independent', async () => {
            const store = model.createStore();
            const plat = new platform.Platform(store, logger, db, az);
            await plat.init();

            const program = az.parseProgram(`
                CREATE TABLE A AS SELECT 1;
                CREATE TABLE B AS SELECT 1;
                CREATE TABLE C AS SELECT 1;
            `);
            az.instantiateProgram();
            const plan = az.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(program.buffer.statementsLength()).toBe(3);
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(3);

            const logic = resolveProgramActionLogic(plan!);
            const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
            const scheduler = new ActionScheduler<proto.action.ProgramAction>(interrupt);
            scheduler.prepare(logic);
            scheduler.actions.forEach((a, i) => {
                expect(a.actionClass).toBe(ActionClass.PROGRAM_ACTION);
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
