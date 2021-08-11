import { model, tasks, TaskScheduler, utils, analyzer, jmespath } from '../src';
import { HTTPMock } from './http_mock';

import * as proto from '@dashql/proto';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';

import TaskStatus = proto.task.TaskStatusCode;
import TaskClass = proto.task.TaskClass;
import ProgramTaskType = proto.task.ProgramTaskType;
import { BATCH_PLAN_ACTIONS, SCHEDULE_PLAN } from 'src/model';

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

    function resolveProgramTaskLogic(plan: model.Plan): [tasks.TaskLogic<proto.task.ProgramTask>[], model.Task[]] {
        const logic: tasks.TaskLogic<proto.task.ProgramTask>[] = [];
        const graph = plan.task_graph;
        expect(graph).toBeDefined();
        expect(graph).not.toBeNull();
        const count = graph!.programTasksLength();
        logic.length = count;
        for (let i = 0; i < count; ++i) {
            const task = graph!.programTasks(i)!;
            expect(task).toBeDefined();
            expect(task).not.toBeNull();
            expect(task.originStatement()).toEqual(i);
            expect(task.taskType()).not.toEqual(ProgramTaskType.NONE);
            const stmt = plan.program.getStatement(i);
            const aid = model.buildTaskHandle(i, TaskClass.PROGRAM_TASK);
            logic[i] = tasks.resolveProgramTaskLogic(aid, task, stmt)!;
            expect(logic[i]).not.toBeNull();
        }
        const now = new Date();
        const infos = logic.map(l => ({
            taskId: l.taskId,
            taskType: l.task.taskType(),
            statusCode: l.task.taskStatusCode(),
            blocker: null,
            dependsOn: l.task.dependsOnArray() || new Uint32Array(),
            requiredFor: l.task.requiredForArray() || new Uint32Array(),
            originStatement: l.task.originStatement(),
            objectId: l.task.objectId(),
            nameQualified: l.task.nameQualified() || '',
            script: l.task.script(),
            timeCreated: now,
            timeScheduled: null,
            timeLastUpdate: now,
        }));
        return [logic, infos];
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

                const [logic, taskInfos] = resolveProgramTaskLogic(plan!);
                ctx.planContextDispatch({
                    type: SCHEDULE_PLAN,
                    data: [plan, taskInfos],
                });

                const interrupt = new Promise((_resolve: (value: any) => void, _reject: (reason?: void) => void) => {});
                const scheduler = new TaskScheduler<proto.task.ProgramTask>(interrupt);
                scheduler.prepare(ctx, logic);
                expect(scheduler.tasks.length).toBe(1);
                expect(scheduler.tasks[0].taskClass).toBe(TaskClass.PROGRAM_TASK);
                expect(scheduler.tasks[0].buffer.taskType()).toBe(ProgramTaskType.CREATE_TABLE);
                expect(scheduler.tasks[0].status).toBe(TaskStatus.SKIPPED);

                ctx.planContextDispatch({
                    type: BATCH_PLAN_ACTIONS,
                    data: ctx.planContextDiff,
                });
                ctx.planContextDiff = [];

                const diff = new utils.NativeStack();
                const workLeft = await scheduler.executeFirst(ctx, diff);
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

                const [logic, taskInfos] = resolveProgramTaskLogic(plan!);
                ctx.planContextDispatch({
                    type: SCHEDULE_PLAN,
                    data: [plan, taskInfos],
                });

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
                    type: BATCH_PLAN_ACTIONS,
                    data: ctx.planContextDiff,
                });
                ctx.planContextDiff = [];

                const diff = new utils.NativeStack();
                let workLeft = await scheduler.executeFirst(ctx, diff);
                expect(scheduler.tasks[0].status).toBe(TaskStatus.COMPLETED);
                expect(workLeft).toBe(true);
                workLeft = await scheduler.execute(ctx, diff);
                expect(workLeft).toBe(true);
                workLeft = await scheduler.execute(ctx, diff);
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

                const [logic, taskInfos] = resolveProgramTaskLogic(plan!);
                ctx.planContextDispatch({
                    type: SCHEDULE_PLAN,
                    data: [plan, taskInfos],
                });

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
                    type: BATCH_PLAN_ACTIONS,
                    data: ctx.planContextDiff,
                });
                ctx.planContextDiff = [];

                const diff = new utils.NativeStack();
                const workLeft = await scheduler.executeFirst(ctx, diff);
                expect(workLeft).toBe(false);
                expect(scheduler.tasks[0].status).toBe(TaskStatus.SKIPPED);
                expect(scheduler.tasks[1].status).toBe(TaskStatus.SKIPPED);
                expect(scheduler.tasks[2].status).toBe(TaskStatus.SKIPPED);
            });
        });
    });
}
