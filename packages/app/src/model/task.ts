// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';

/// An task id
export type TaskHandle = number;

/// The scheduler status
export enum TaskSchedulerStatus {
    IDLE = 0,
    PREPARE_SCHEDULER = 2,
    EXECUTE_SETUP_FIRST = 3,
    EXECUTE_SETUP_NEXT = 4,
    EXECUTE_PROGRAM_FIRST = 5,
    EXECUTE_PROGRAM_NEXT = 6,
}

/// Build an task id
export function buildTaskHandle(task_idx: number, task_class: proto.task.TaskClass): TaskHandle {
    return (task_idx << 1) | (task_class as number);
}
/// Load the task class from the id
export function getTaskClass(task_id: TaskHandle): proto.task.TaskClass {
    return (task_id & 1) as proto.task.TaskClass;
}
/// Load the task index from the id
export function getTaskIndex(task_id: TaskHandle): number {
    return task_id >> 1;
}

export interface Task {
    /// The task id
    taskId: TaskHandle;
    /// The setup task
    taskType: proto.task.SetupTaskType | proto.task.ProgramTaskType;
    /// The status code
    statusCode: proto.task.TaskStatusCode;
    /// The blocker
    blocker: proto.task.TaskBlocker | null;

    /// The dependencies
    dependsOn: Uint32Array;
    /// The dependencies
    requiredFor: Uint32Array;

    /// The origin statement
    originStatement: number | null;
    /// The object id
    objectId: number | null;
    /// The qualified name
    nameQualified: string;
    /// The script (if any)
    script: string | null;

    /// The time when the task was created
    timeCreated: Date | null;
    /// The time of the first schedule
    timeScheduled: Date | null;
    /// The time of the last update
    timeLastUpdate: Date | null;
}

export interface TaskUpdate {
    /// The task id
    taskId: TaskHandle;
    /// The status code
    statusCode: proto.task.TaskStatusCode;
    /// The blocker (if any)
    blocker: proto.task.TaskBlocker | null;
}
