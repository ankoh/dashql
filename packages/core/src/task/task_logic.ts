// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import { TaskHandle, Statement, getTaskClass, getTaskIndex } from '../model';
import { TaskExecutionContext } from './task_execution_context';

export interface ProtoTask {
    taskStatusCode(): proto.task.TaskStatusCode;

    dependsOn(index: number): number | null;
    dependsOnLength(): number;
    dependsOnArray(): Uint32Array | null;
    requiredFor(index: number): number | null;
    requiredForLength(): number;
    requiredForArray(): Uint32Array | null;

    objectId(): number;
    mutate_object_id(value: number): boolean;

    nameQualified(): string | null;
}

export type TaskError = any;

export abstract class TaskLogic<TaskBuffer extends ProtoTask> {
    /// The task id
    _task_id: TaskHandle;
    /// The protocol buffer
    _task: TaskBuffer;
    /// The status
    _status: proto.task.TaskStatusCode;
    /// The blocker (if any)
    _blocker: proto.task.TaskBlocker | null = null;

    /// Constructor
    constructor(task_id: TaskHandle, task: TaskBuffer) {
        this._task_id = task_id;
        this._task = task;
        this._status = task.taskStatusCode();
    }

    /// Get the task
    public get task(): TaskBuffer {
        return this._task;
    }
    /// Get the task id
    public get taskId(): number {
        return this._task_id;
    }
    /// Get the task class
    public get taskClass(): proto.task.TaskClass {
        return getTaskClass(this._task_id);
    }
    /// Get the task index
    public get taskIndex(): number {
        return getTaskIndex(this._task_id);
    }
    /// Get the flatbuffer
    public get buffer(): TaskBuffer {
        return this._task;
    }
    /// Get the status
    public get status(): proto.task.TaskStatusCode {
        return this._status;
    }
    /// Set the task status
    public set status(status: proto.task.TaskStatusCode) {
        this._status = status;
    }
    /// Get the blocker
    public get blocker(): proto.task.TaskBlocker | null {
        return this._blocker;
    }

    /// Prepare an task
    public abstract prepare(context: TaskExecutionContext): void;
    /// Will execute an task
    public abstract willExecute(context: TaskExecutionContext): void;
    /// Execute an task
    public abstract execute(context: TaskExecutionContext): Promise<void>;

    /// Prepare the execution guarded
    public willExecuteGuarded(context: TaskExecutionContext): TaskError | null {
        try {
            this._status = proto.task.TaskStatusCode.RUNNING;
            this.willExecute(context);
            return null;
        } catch (e) {
            console.log(e);
            this._status = proto.task.TaskStatusCode.FAILED;
            return e;
        }
    }
    /// Execute the task guarded
    public async executeGuarded(context: TaskExecutionContext): Promise<[TaskHandle, TaskError | null]> {
        try {
            this._status = proto.task.TaskStatusCode.RUNNING;
            await this.execute(context);
            this._status = proto.task.TaskStatusCode.COMPLETED;
            return [this._task_id, null];
        } catch (e) {
            console.log(e);
            this._status = proto.task.TaskStatusCode.FAILED;
            return [this._task_id, e];
        }
    }
}

export abstract class ProgramTaskLogic extends TaskLogic<proto.task.ProgramTask> {
    /// The origin statement
    _origin: Statement;

    /// Constructor
    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, origin: Statement) {
        super(task_id, task);
        this._origin = origin;
        this._status = task.taskStatusCode();
    }

    /// Return the origin
    public get origin(): Statement {
        return this._origin;
    }
    /// Return the script
    public get script(): string | null {
        return this._task.script() || null;
    }
}

export abstract class SetupTaskLogic extends TaskLogic<proto.task.SetupTask> {
    /// Constructor
    constructor(task_id: TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
        this._status = task.taskStatusCode();
    }
}
