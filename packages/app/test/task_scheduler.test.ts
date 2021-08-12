import { model, tasks, TaskScheduler, analyzer, jmespath } from '../src';
import { HTTPMock } from './http_mock';

import * as proto from '@dashql/proto';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';

import TaskStatus = proto.task.TaskStatusCode;
import TaskClass = proto.task.TaskClass;
import ProgramTaskType = proto.task.ProgramTaskType;
import { SCHEDULER_STEP_DONE, SCHEDULE_PLAN, TaskSchedulerStatus } from '../src/model';

export function testTaskScheduler(
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
        const r: tasks.TaskLogic<proto.task.ProgramTask>[] = [];
        const graph = plan.task_graph;
        expect(graph).toBeDefined();
        expect(graph).not.toBeNull();
        const count = graph!.programTasksLength();
        r.length = count;
        for (let i = 0; i < count; ++i) {
            const action = graph!.programTasks(i)!;
            expect(action).toBeDefined();
            expect(action).not.toBeNull();
            expect(action.originStatement()).toEqual(i);
            expect(action.taskType()).not.toEqual(ProgramTaskType.NONE);
            const stmt = plan.program.getStatement(i);
            const aid = model.buildTaskHandle(i, TaskClass.PROGRAM_TASK);
            r[i] = tasks.resolveProgramTaskLogic(aid, action, stmt)!;
            expect(r[i]).not.toBeNull();
        }
        return r;
    }

    describe('Task Scheduler', () => {
        describe('program tasks', () => {
            it('single table', async () => {
                const ctx = await tasks.wireTaskExecutionContext(db(), az(), async () => jp());

                const program = az().parseProgram('CREATE TABLE a AS SELECT 1');
                az().instantiateProgram();
                const plan = az().planProgram();
                const graph = plan!.buffer.taskGraph()!;
                expect(program.buffer.statementsLength()).toBe(1);
                expect(graph.setupTasksLength()).toBe(0);
                expect(graph.programTasksLength()).toBe(1);

                ctx.planContextDispatch({
                    type: SCHEDULE_PLAN,
                    data: plan,
                });

                const logic = resolveProgramActionLogic(plan!);
                const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
                const scheduler = new TaskScheduler<proto.task.ProgramTask>(interrupt);
                scheduler.prepare(ctx, logic);
                expect(scheduler.tasks.length).toBe(1);
                expect(scheduler.tasks[0].taskClass).toBe(TaskClass.PROGRAM_TASK);
                expect(scheduler.tasks[0].buffer.taskType()).toBe(ProgramTaskType.CREATE_TABLE);
                expect(scheduler.tasks[0].status).toBe(TaskStatus.SKIPPED);

                ctx.planContextDispatch({
                    type: SCHEDULER_STEP_DONE,
                    data: [TaskSchedulerStatus.EXECUTE_PROGRAM, ctx.planContextDiff],
                });
                ctx.planContextDiff.length = 0;

                const workLeft = await scheduler.execute(ctx);
                expect(workLeft).toBe(false);
                expect(scheduler.tasks[0].status).toBe(TaskStatus.SKIPPED);
            });

            it('tree', async () => {
                const ctx = await tasks.wireTaskExecutionContext(db(), az(), async () => jp());

                const program = az().parseProgram(`
                    CREATE TABLE weather AS SELECT 1;
                    VIZ weather USING TABLE;
                    VIZ weather USING TABLE;
                `);
                az().instantiateProgram();
                const plan = az().planProgram();
                const graph = plan!.buffer.taskGraph()!;
                expect(program.buffer.statementsLength()).toBe(3);
                expect(graph.setupTasksLength()).toBe(0);
                expect(graph.programTasksLength()).toBe(3);

                ctx.planContextDispatch({
                    type: SCHEDULE_PLAN,
                    data: plan,
                });

                const logic = resolveProgramActionLogic(plan!);
                const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
                const scheduler = new TaskScheduler<proto.task.ProgramTask>(interrupt);
                scheduler.prepare(ctx, logic);
                scheduler.tasks.forEach((a, i) => {
                    expect(a.taskClass).toBe(TaskClass.PROGRAM_TASK);
                    expect(a.buffer.originStatement()).toBe(i);
                    expect(a.status).toBe(TaskStatus.PENDING);
                });
                expect(scheduler.tasks.map(a => a.buffer.taskType())).toEqual([
                    ProgramTaskType.CREATE_TABLE,
                    ProgramTaskType.CREATE_VIZ,
                    ProgramTaskType.CREATE_VIZ,
                ]);
                expect(scheduler.tasks.map(a => a.buffer.dependsOnArray())).toEqual([
                    null,
                    new Uint32Array([0]),
                    new Uint32Array([0]),
                ]);
                expect(scheduler.tasks.map(a => a.buffer.requiredForArray())).toEqual([
                    new Uint32Array([1, 2]),
                    null,
                    null,
                ]);

                ctx.planContextDispatch({
                    type: SCHEDULER_STEP_DONE,
                    data: [TaskSchedulerStatus.EXECUTE_PROGRAM, ctx.planContextDiff],
                });
                ctx.planContextDiff = [];

                let workLeft = await scheduler.execute(ctx);
                expect(scheduler.tasks[0].status).toBe(TaskStatus.COMPLETED);
                expect(workLeft).toBe(true);
                workLeft = await scheduler.execute(ctx);
                expect(workLeft).toBe(true);
                workLeft = await scheduler.execute(ctx);
                expect(scheduler.tasks[1].status).toBe(TaskStatus.COMPLETED);
                expect(scheduler.tasks[2].status).toBe(TaskStatus.COMPLETED);
                expect(workLeft).toBe(false);
            });

            it('independent', async () => {
                const ctx = await tasks.wireTaskExecutionContext(db(), az(), async () => jp());

                const program = az().parseProgram(`
                    CREATE TABLE A AS SELECT 1;
                    CREATE TABLE B AS SELECT 1;
                    CREATE TABLE C AS SELECT 1;
                `);
                az().instantiateProgram();
                const plan = az().planProgram();
                const graph = plan!.buffer.taskGraph()!;
                expect(program.buffer.statementsLength()).toBe(3);
                expect(graph.setupTasksLength()).toBe(0);
                expect(graph.programTasksLength()).toBe(3);

                ctx.planContextDispatch({
                    type: SCHEDULE_PLAN,
                    data: plan,
                });

                const logic = resolveProgramActionLogic(plan!);
                const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
                const scheduler = new TaskScheduler<proto.task.ProgramTask>(interrupt);
                scheduler.prepare(ctx, logic);
                scheduler.tasks.forEach((a, i) => {
                    expect(a.taskClass).toBe(TaskClass.PROGRAM_TASK);
                    expect(a.buffer.originStatement()).toBe(i);
                    expect(a.status).toBe(TaskStatus.SKIPPED);
                });
                expect(scheduler.tasks.map(a => a.buffer.taskType())).toEqual([
                    ProgramTaskType.CREATE_TABLE,
                    ProgramTaskType.CREATE_TABLE,
                    ProgramTaskType.CREATE_TABLE,
                ]);
                expect(scheduler.tasks.map(a => a.buffer.dependsOnArray())).toEqual([null, null, null]);
                expect(scheduler.tasks.map(a => a.buffer.requiredForArray())).toEqual([null, null, null]);

                ctx.planContextDispatch({
                    type: SCHEDULER_STEP_DONE,
                    data: [TaskSchedulerStatus.EXECUTE_PROGRAM, ctx.planContextDiff],
                });
                ctx.planContextDiff = [];

                const workLeft = await scheduler.execute(ctx);
                expect(workLeft).toBe(false);
                expect(scheduler.tasks[0].status).toBe(TaskStatus.SKIPPED);
                expect(scheduler.tasks[1].status).toBe(TaskStatus.SKIPPED);
                expect(scheduler.tasks[2].status).toBe(TaskStatus.SKIPPED);
            });
        });
    });
}
