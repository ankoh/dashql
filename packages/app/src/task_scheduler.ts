// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import { NativeBitmap, NativeStack, NativeMinHeap, NativeMinHeapKey, NativeMinHeapRank } from './utils';
import { TaskLogic, ProtoTask, resolveSetupTaskLogic, resolveProgramTaskLogic } from './task';
import { TaskError } from './task';
import { TaskExecutionContext } from './task/task_execution_context';
import {
    TaskHandle,
    Task,
    TaskUpdate,
    buildTaskHandle,
    getTaskIndex,
    getTaskClass,
    LogLevel,
    LogOrigin,
    LogTopic,
    LogEvent,
    SCHEDULE_PLAN,
    BATCH_PLAN_ACTIONS,
    UPDATE_PLAN_TASKS,
    Plan,
} from './model';

export class TaskScheduler<TaskBuffer extends ProtoTask> {
    /// The cancel promise.
    /// Resolves to [null, null].
    _interrupt: Promise<[TaskHandle | null, TaskError | null]>;

    /// The tasks
    _tasks: TaskLogic<TaskBuffer>[] = [];
    /// The pending tasks
    _taskQueue: NativeMinHeap = new NativeMinHeap();
    /// The task promises
    _taskPromises: (Promise<[TaskHandle, TaskError | null]> | null)[] = [];

    /// The scheduled tasks
    _scheduledTasks: NativeBitmap = new NativeBitmap();
    /// The completed tasks
    _completedTasks: NativeBitmap = new NativeBitmap();
    /// The failed tasks
    _failedTasks: NativeBitmap = new NativeBitmap();

    constructor(interrupt: Promise<void>) {
        this._interrupt = interrupt.then(() => [null, null]);
    }

    /// Get the scheduled tasks
    public get scheduled(): NativeBitmap {
        return this._scheduledTasks;
    }

    /// Prepare the scheduler
    public prepare(ctx: TaskExecutionContext, tasks: TaskLogic<TaskBuffer>[]): void {
        this._tasks = tasks;
        this._taskPromises = [];

        // Build the dependency heap
        const deps: [NativeMinHeapKey, NativeMinHeapRank][] = [];
        deps.length = tasks.length;
        for (let i = 0; i < tasks.length; ++i) {
            deps[i] = [i, tasks[i].buffer.dependsOnLength()];
            this._taskPromises.push(null);
        }
        deps.sort((l, r) => l[1] - r[1]);
        this._taskQueue.build(deps);

        // Build the status bitmaps
        this._scheduledTasks.reset(this._tasks.length);
        this._completedTasks.reset(this._tasks.length);
        this._failedTasks.reset(this._tasks.length);

        for (let i = 0; i < tasks.length; ++i) {
            switch (tasks[i].status) {
                case proto.task.TaskStatusCode.SKIPPED:
                case proto.task.TaskStatusCode.COMPLETED:
                    this.taskCompleted(i);
                    break;
                case proto.task.TaskStatusCode.FAILED:
                    this._failedTasks.set(i);
                    break;
                default:
                    tasks[i].prepare(ctx);
                    break;
            }
        }
    }

    /// Get the tasks
    public get tasks(): TaskLogic<TaskBuffer>[] {
        return this._tasks;
    }
    /// Set the scheduler interrupt promise
    public set interrupt(interrupt: Promise<void>) {
        this._interrupt = interrupt.then(() => [null, null]);
    }

    /// Is there work left?
    public workLeft(): boolean {
        return !this._scheduledTasks.empty();
    }
    /// Are no more tasks scheduled?
    public noneScheduled(): boolean {
        return this._scheduledTasks.empty();
    }
    /// Are there failed tasks?
    public someFailed(): boolean {
        return !this._failedTasks.empty();
    }
    /// Are all complete?
    public allComplete(): boolean {
        return this._completedTasks.allSet();
    }

    /// An aciton completd
    protected taskCompleted(taskIdx: number): void {
        this._completedTasks.set(taskIdx);
        const requiredFor = this._tasks[taskIdx].buffer.requiredForArray();
        for (const req of requiredFor || []) {
            this._taskQueue.decrementRank(req);
        }
    }

    /// Schedule all tasks that can be scheduled.
    /// An task can be scheduled if its rank is zero in the dependency heap.
    protected scheduleNext(ctx: TaskExecutionContext, touchedTasks: NativeStack): void {
        // Collect next tasks
        const next_task_idcs: number[] = [];
        while (!this._taskQueue.empty() && this._taskQueue.topRank() == 0) {
            const task_idx = this._taskQueue.top();
            this._taskQueue.pop();
            touchedTasks.push(task_idx);

            // Task already done, register as completed?
            if (
                this._tasks[task_idx].status == proto.task.TaskStatusCode.COMPLETED ||
                this._tasks[task_idx].status == proto.task.TaskStatusCode.SKIPPED
            ) {
                this.taskCompleted(task_idx);
                continue;
            }
            // Remember next task id
            next_task_idcs.push(task_idx);
        }

        // Prepare all tasks for execution
        for (let i = 0; i < next_task_idcs.length; ++i) {
            const next_task_idx = next_task_idcs[i];
            const next_task = this._tasks[next_task_idx];
            const err = next_task.willExecuteGuarded(ctx);
            if (err != null) {
                next_task_idcs[i] = -1;
                ctx.logger.pushBack({
                    timestamp: new Date(),
                    level: LogLevel.WARNING,
                    origin: LogOrigin.TASK_SCHEDULER,
                    topic: LogTopic.PREPARE_TASK,
                    event: LogEvent.ERROR,
                    value: err,
                });
            }
        }
        // Schedule all tasks
        for (const next_task_idx of next_task_idcs) {
            // Fiailed to prepare?
            if (next_task_idx == -1) continue;
            // Set task status to running
            const next_task = this._tasks[next_task_idx];
            next_task.status = proto.task.TaskStatusCode.RUNNING;
            this._scheduledTasks.set(next_task_idx);
            // Execute the task
            this._taskPromises[next_task_idx] = next_task.executeGuarded(ctx);
        }
    }

    /// Execute the first time.
    /// Returns true if execute should be called again.
    public async executeFirst(ctx: TaskExecutionContext, touchedTasks: NativeStack): Promise<boolean> {
        this.scheduleNext(ctx, touchedTasks);
        return this.execute(ctx, touchedTasks);
    }

    /// Waits until one of the currently running task promises resolves or rejects.
    /// Returns true if execute should be called again.
    public async execute(ctx: TaskExecutionContext, touchedTasks: NativeStack): Promise<boolean> {
        // Nothing to do?
        if (!this.workLeft()) return false;

        // Flush any task updates
        this.flushTaskUpdates(ctx, touchedTasks);

        // Wait for next task to complete
        const promises: Promise<[TaskHandle | null, TaskError | null]>[] = [this._interrupt];
        this._taskPromises.forEach(p => {
            if (p) promises.push(p);
        });

        const [next, err] = await Promise.race(promises);
        if (next == null) {
            /// Return true to indicate that we're not yet done and let the graph scheduler figure out whats wrong.
            return true;
        }
        touchedTasks.push(getTaskIndex(next));

        // Check the new status of the task
        const task_idx = getTaskIndex(next);
        this._taskPromises[task_idx] = null;
        switch (this._tasks[task_idx].status) {
            case proto.task.TaskStatusCode.BLOCKED:
            case proto.task.TaskStatusCode.RUNNING:
                break;

            case proto.task.TaskStatusCode.SKIPPED:
            case proto.task.TaskStatusCode.COMPLETED: {
                this._scheduledTasks.clear(task_idx);
                this.taskCompleted(task_idx);
                this.scheduleNext(ctx, touchedTasks);
                break;
            }
            case proto.task.TaskStatusCode.PENDING:
            case proto.task.TaskStatusCode.FAILED:
                this._scheduledTasks.clear(task_idx);
                this._failedTasks.set(task_idx);
                break;
        }

        // Did the task fail?
        // Log the error
        if (err != null) {
            ctx.logger.pushBack({
                timestamp: new Date(),
                level: LogLevel.WARNING,
                origin: LogOrigin.TASK_SCHEDULER,
                topic: LogTopic.EXECUTE_TASK,
                event: LogEvent.ERROR,
                value: err,
            });
        }

        // Flush any task updates
        this.flushTaskUpdates(ctx, touchedTasks);
        // No more scheduled tasks left?
        return this.workLeft();
    }

    /// Flush teh task updates
    public flushTaskUpdates(ctx: TaskExecutionContext, touchedTasks: NativeStack): void {
        if (touchedTasks.empty()) return;

        // Synchronize all tasks in the diff
        const taskUpdates: Map<number, TaskUpdate> = new Map();
        for (; !touchedTasks.empty(); touchedTasks.pop()) {
            const taskIdx = touchedTasks.top();
            const task = this.tasks[taskIdx];
            // Only propagate the most recent one
            if (taskUpdates.get(task.taskId)) continue;
            // Mark the task as updated
            taskUpdates.set(task.taskId, {
                taskId: task.taskId,
                statusCode: task.status,
                blocker: task.blocker,
            });
        }

        // Update the task status in the analyzer
        const flatUpdates = Array.from(taskUpdates, ([_k, v]) => v);
        for (const u of flatUpdates) {
            ctx.analyzer.updateTaskStatus(getTaskClass(u.taskId), getTaskIndex(u.taskId), u.statusCode);
        }
        // Update all tasks in the store
        ctx.planContextDiff.push({
            type: UPDATE_PLAN_TASKS,
            data: flatUpdates,
        });
        ctx.planContextDispatch({
            type: BATCH_PLAN_ACTIONS,
            data: ctx.planContextDiff,
        });
        ctx.planContextDiff = [];
    }
}

export class TaskGraphScheduler {
    /// The cancel promise
    _interruptPromise: Promise<void>;
    /// The cancel promise
    _interruptFunction: () => void;
    /// Has been canceled?
    _canceled: boolean;

    /// The setup tasks
    _setupScheduler: TaskScheduler<proto.task.SetupTask>;
    /// The program tasks
    _programScheduler: TaskScheduler<proto.task.ProgramTask>;

    /// Constructor
    constructor() {
        this._interruptFunction = () => {};
        this._interruptPromise = new Promise((resolve: () => void, _reject: (reason?: void) => void) => {
            this._interruptFunction = () => resolve();
        });
        this._canceled = false;

        // Setup the schedulers
        this._setupScheduler = new TaskScheduler<proto.task.SetupTask>(this._interruptPromise);
        this._programScheduler = new TaskScheduler<proto.task.ProgramTask>(this._interruptPromise);
    }

    /// Reset the scheduler
    public prepare(ctx: TaskExecutionContext, plan: Plan): void {
        this._canceled = false;
        const program = plan.program;
        const graph = plan.task_graph;
        const now = new Date();
        if (!graph) return;

        // Translate the setup tasks
        const taskInfos: Task[] = [];
        const setupLogic = [];
        for (let i = 0; i < graph.setupTasksLength(); ++i) {
            const taskId = buildTaskHandle(i, proto.task.TaskClass.SETUP_TASK);
            const a = graph.setupTasks(i)!;
            const logic = resolveSetupTaskLogic(taskId, a)!;
            logic.status = a.taskStatusCode();
            setupLogic.push(logic);
            taskInfos.push({
                taskId: taskId,
                taskType: a.taskType(),
                statusCode: a.taskStatusCode(),
                blocker: null,
                dependsOn: a.dependsOnArray() || new Uint32Array(),
                requiredFor: a.requiredForArray() || new Uint32Array(),
                originStatement: null,
                objectId: a.objectId(),
                nameQualified: a.nameQualified() || '',
                script: null,
                timeCreated: now,
                timeScheduled: null,
                timeLastUpdate: now,
            });
        }

        // Translate the program tasks
        const programLogic = [];
        for (let i = 0; i < graph.programTasksLength(); ++i) {
            const taskId = buildTaskHandle(i, proto.task.TaskClass.PROGRAM_TASK);
            const a = graph.programTasks(i)!;
            const s = program.getStatement(a.originStatement());
            const logic = resolveProgramTaskLogic(taskId, a, s)!;
            logic.status = a.taskStatusCode();
            programLogic.push(logic);
            taskInfos.push({
                taskId: taskId,
                taskType: a.taskType(),
                statusCode: a.taskStatusCode(),
                blocker: null,
                dependsOn: a.dependsOnArray() || new Uint32Array(),
                requiredFor: a.requiredForArray() || new Uint32Array(),
                originStatement: a.originStatement(),
                objectId: a.objectId(),
                nameQualified: a.nameQualified() || '',
                script: a.script(),
                timeCreated: now,
                timeScheduled: null,
                timeLastUpdate: now,
            });
        }

        // Schedule the plan.
        // We need to set the plan in redux BEFORE we run the setup tasks since they rely on the state.
        ctx.planContextDispatch({
            type: SCHEDULE_PLAN,
            data: [plan, taskInfos],
        });

        // Prepare all tasks
        this._setupScheduler.prepare(ctx, setupLogic);
        this._programScheduler.prepare(ctx, programLogic);

        // Insert all plan objects required by the tasks.
        // Note that we deliberately batch the updates here to have only one state transition.
        ctx.planContextDispatch({
            type: BATCH_PLAN_ACTIONS,
            data: ctx.planContextDiff,
        });
        ctx.planContextDiff = [];
    }

    /// Interrupt the scheduler
    protected interrupt(): void {
        // Setup a new interrupt promise
        const prev_interrupt = this._interruptFunction;
        this._interruptFunction = () => {};
        this._interruptPromise = new Promise((resolve: () => void, _reject: (reason?: void) => void) => {
            this._interruptFunction = () => resolve();
        });
        this._setupScheduler.interrupt = this._interruptPromise;
        this._programScheduler.interrupt = this._interruptPromise;

        // Fire the interrupt
        prev_interrupt();
    }

    /// Cancel the scheduler
    public cancel(): void {
        this._canceled = true;
        this.interrupt();
    }

    /// Execute all exctions of a scheduler
    protected async executeTasks<TaskBuffer extends ProtoTask>(
        ctx: TaskExecutionContext,
        diff: NativeStack,
        scheduler: TaskScheduler<TaskBuffer>,
    ): Promise<void> {
        for (
            let workLeft = await scheduler.executeFirst(ctx, diff);
            workLeft;
            workLeft = await scheduler.execute(ctx, diff)
        );
    }

    /// Execute the entire task graph
    public async execute(ctx: TaskExecutionContext): Promise<void> {
        if (ctx.planContext.plan == null) return;
        const diff = new NativeStack(64);
        await this.executeTasks(ctx, diff, this._setupScheduler);
        diff.clear();
        await this.executeTasks(ctx, diff, this._programScheduler);
    }
}
