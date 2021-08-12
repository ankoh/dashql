// Copyright (c) 2021 The DashQL Authors

import Immutable from 'immutable';
import React from 'react';
import * as proto from '@dashql/proto';
import { StatementStatus, deriveStatementStatusCode } from './program';
import { TaskHandle, Task, TaskUpdate, TaskSchedulerStatus, buildTaskHandle } from './task';
import { Action, Dispatch, ProviderProps } from './model_context';
import { Plan } from './plan';
import { CardSpecification } from './card_specification';
import { UniqueBlob } from './unique_blob';

type ObjectID = number;

export interface PlanContext {
    /// The plan
    readonly plan: Plan | null;
    /// The action scheduler status
    readonly schedulerStatus: TaskSchedulerStatus;
    /// The status
    readonly statementStatus: Immutable.List<StatementStatus>;
    /// The objects
    readonly blobs: Immutable.Map<ObjectID, UniqueBlob>;
    /// The blobs by name
    readonly blobsByName: Immutable.Map<string, ObjectID>;
    /// The cards
    readonly cards: Immutable.Map<ObjectID, CardSpecification>;
    /// The plan tasks
    readonly tasks: Immutable.Map<TaskHandle, Task>;
}

export const initialPlanContext: PlanContext = {
    plan: null,
    schedulerStatus: TaskSchedulerStatus.IDLE,
    statementStatus: Immutable.List<StatementStatus>(),
    blobs: Immutable.Map<ObjectID, UniqueBlob>(),
    blobsByName: Immutable.Map<string, ObjectID>(),
    cards: Immutable.Map<ObjectID, CardSpecification>(),
    tasks: Immutable.Map<TaskHandle, Task>(),
};

export const ADD_BLOB = Symbol('ADD_BLOB');
export const ADD_CARD = Symbol('ADD_CARD');
export const UPDATE_CARD = Symbol('UPDATE_CARD');
export const DELETE_BLOB = Symbol('DELETE_BLOB');
export const DELETE_CARD = Symbol('DELETE_CARD');
export const RESET_PLAN = Symbol('RESET_PLAN');
export const SCHEDULER_READY = Symbol('SCHEDULER_READY');
export const SCHEDULE_PLAN = Symbol('SCHEDULE_PLAN');
export const SCHEDULER_STEP_DONE = Symbol('SCHEDULER_STEP_DONE');
export const UPDATE_PLAN_TASKS = Symbol('UPDATE_PLAN_TASKS');
export const HIDE_CARDS = Symbol('HIDE_CARDS');

export type PlanContextAction =
    | Action<typeof SCHEDULE_PLAN, Plan>
    | Action<typeof RESET_PLAN, null>
    | Action<typeof UPDATE_PLAN_TASKS, TaskUpdate[]>
    | Action<typeof ADD_BLOB, UniqueBlob>
    | Action<typeof ADD_CARD, CardSpecification>
    | Action<typeof UPDATE_CARD, Partial<CardSpecification> & { objectId: number }>
    | Action<typeof DELETE_BLOB, ObjectID>
    | Action<typeof DELETE_CARD, ObjectID>
    | Action<typeof HIDE_CARDS, null>
    | Action<typeof SCHEDULER_STEP_DONE, [TaskSchedulerStatus, PlanContextAction[]]>;

export const reducePlanContext = (ctx: PlanContext, action: PlanContextAction): PlanContext => {
    switch (action.type) {
        case ADD_BLOB:
            return {
                ...ctx,
                blobs: ctx.blobs.set(action.data.objectId, action.data),
                blobsByName: ctx.blobsByName.set(action.data.nameQualified, action.data.objectId),
            };
        case ADD_CARD:
            return {
                ...ctx,
                cards: ctx.cards.set(action.data.objectId, action.data),
            };
        case UPDATE_CARD:
            return {
                ...ctx,
                cards: ctx.cards.withMutations(c => {
                    const prev = c.get(action.data.objectId);
                    if (!prev) return;
                    c.set(action.data.objectId, {
                        ...prev,
                        ...action.data,
                    });
                }),
            };
        case HIDE_CARDS:
            return {
                ...ctx,
                cards: ctx.cards.map(c => ({
                    ...c,
                    visible: false,
                })),
            };
        case DELETE_BLOB: {
            const blob = ctx.blobs.get(action.data);
            if (blob === undefined) return ctx;
            return {
                ...ctx,
                blobs: ctx.blobs.delete(blob.objectId),
                blobsByName: ctx.blobsByName.delete(blob.nameQualified),
            };
        }
        case DELETE_CARD:
            return {
                ...ctx,
                cards: ctx.cards.delete(action.data),
            };
        case SCHEDULER_STEP_DONE: {
            const [nextStatus, actions] = action.data;
            return {
                ...actions.reduce((c, a) => {
                    return reducePlanContext(c, a);
                }, ctx),
                schedulerStatus: nextStatus,
            };
        }
        case SCHEDULE_PLAN: {
            const plan = action.data;
            const graph = plan.task_graph;
            if (!graph) return ctx;

            // Translate the setup tasks
            const now = new Date();
            const tasks: Task[] = [];
            for (let i = 0; i < graph.setupTasksLength(); ++i) {
                const taskId = buildTaskHandle(i, proto.task.TaskClass.SETUP_TASK);
                const a = graph.setupTasks(i)!;
                tasks.push({
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
            for (let i = 0; i < graph.programTasksLength(); ++i) {
                const taskId = buildTaskHandle(i, proto.task.TaskClass.PROGRAM_TASK);
                const a = graph.programTasks(i)!;
                tasks.push({
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

            // Derive the statement status
            const status: StatementStatus[] = [];
            for (let i = 0; i < plan.program!.buffer.statementsLength(); ++i) {
                status.push({
                    status: proto.task.TaskStatusCode.PENDING,
                    totalTasks: 0,
                    totalPerStatus: [0, 0, 0, 0, 0, 0],
                });
            }
            tasks.forEach(a => {
                if (a.originStatement != null) {
                    ++status[a.originStatement].totalTasks;
                    ++status[a.originStatement].totalPerStatus[a.statusCode as number];
                }
            });
            for (const s of status) {
                s.status = deriveStatementStatusCode(s);
            }

            // Build the new plan state
            return {
                ...ctx,
                plan,
                schedulerStatus: TaskSchedulerStatus.PREPARE_SCHEDULER,
                statementStatus: Immutable.List(status),
                tasks: Immutable.Map<TaskHandle, Task>(tasks.map(t => [t.taskId, t])),
            };
        }
        case RESET_PLAN:
            if (ctx.schedulerStatus !== TaskSchedulerStatus.IDLE) {
                return ctx;
            }
            return {
                ...ctx,
                schedulerStatus: TaskSchedulerStatus.IDLE,
                plan: null,
                statementStatus: Immutable.List([]),
                tasks: Immutable.Map<TaskHandle, Task>(),
            };
        case UPDATE_PLAN_TASKS: {
            return {
                ...ctx,
                statementStatus: ctx.statementStatus.withMutations(status => {
                    for (const update of action.data) {
                        const task = ctx.tasks.get(update.taskId);
                        if (!task || task.originStatement == null || task.statusCode == update.statusCode) {
                            continue;
                        }
                        const origin = { ...status.get(task.originStatement)! };
                        --origin.totalPerStatus[task.statusCode as number];
                        ++origin.totalPerStatus[update.statusCode as number];
                        origin.status = deriveStatementStatusCode(origin);
                        status.set(task.originStatement, origin);
                    }
                }),
                tasks: ctx.tasks.withMutations(tasks => {
                    const now = new Date();
                    for (const update of action.data) {
                        const a = tasks.get(update.taskId);
                        if (!a) {
                            console.warn(`UPDATE_PLAN_ACTIONS refers to unknown task id: ${update.taskId}`);
                            continue;
                        }
                        tasks.set(update.taskId, {
                            ...a,
                            statusCode: update.statusCode,
                            blocker: update.blocker,
                            timeScheduled: a.timeCreated || now,
                            timeLastUpdate: now,
                        });
                    }
                }),
            };
        }
    }
};

const stateCtx = React.createContext<PlanContext>(initialPlanContext);
const dispatchCtx = React.createContext<Dispatch<PlanContextAction>>(() => {});

export const PlanContextProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const [s, d] = React.useReducer(reducePlanContext, initialPlanContext);
    return (
        <stateCtx.Provider value={s}>
            <dispatchCtx.Provider value={d}>{props.children}</dispatchCtx.Provider>
        </stateCtx.Provider>
    );
};

export const usePlanContext = (): PlanContext => React.useContext(stateCtx);
export const usePlanContextDispatch = (): Dispatch<PlanContextAction> => React.useContext(dispatchCtx);
