// Copyright (c) 2020 The DashQL Authors

import Immutable from 'immutable';
import { StatementStatus } from './program';
import { CardSpecification } from './card_specification';
import { TableSummary } from './table_summary';
import { PlanObject, PlanObjectType, PlanObjectID } from './plan_object';
import { TaskHandle, TaskUpdate, Task } from './task';
import { deriveStatementStatusCode } from './program';
import { UniqueBlob } from './unique_blob';

type ObjectID = number;

export interface PlanState {
    /// The status
    readonly status: Immutable.List<StatementStatus>;
    /// The objects
    readonly objects: Immutable.Map<ObjectID, PlanObject>;
    /// The blobs by name
    readonly blobsByName: Immutable.Map<string, ObjectID>;
    /// The tables by name
    readonly tablesByName: Immutable.Map<string, ObjectID>;
    /// The plan tasks
    readonly tasks: Immutable.Map<TaskHandle, Task>;
}

export const createPlanState = (): PlanState => ({
    status: Immutable.List<StatementStatus>(),
    objects: Immutable.Map<number, PlanObject>(),
    blobsByName: Immutable.Map<string, number>(),
    tablesByName: Immutable.Map<string, number>(),
    tasks: Immutable.Map<number, Task>(),
});

export const resetStatus = (state: PlanState, status: StatementStatus[] = [], tasks: Task[] = []): PlanState => ({
    ...state,
    status: Immutable.List(status),
    tasks: Immutable.Map<TaskHandle, Task>(tasks.map(a => [a.taskId, a])),
});

export const updateStatus = (state: PlanState, updates: TaskUpdate[]): PlanState => ({
    ...state,
    status: state.status.withMutations(status => {
        for (const update of updates) {
            const task = state.tasks.get(update.taskId);
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
    tasks: state.tasks.withMutations(tasks => {
        const now = new Date();
        for (const update of updates) {
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
});

export const insertObjects = (state: PlanState, objects: PlanObject[]): PlanState => {
    const blobs = objects.filter(o => o.objectType == PlanObjectType.UNIQUE_BLOB) as UniqueBlob[];
    const tables = objects.filter(o => o.objectType == PlanObjectType.TABLE_SUMMARY) as TableSummary[];
    return {
        ...state,
        objects: state.objects.withMutations(os => objects.forEach(o => os.set(o.objectId, o))),
        blobsByName: state.blobsByName.withMutations(os => blobs.forEach(o => os.set(o.nameQualified, o.objectId))),
        tablesByName: state.tablesByName.withMutations(os => tables.forEach(o => os.set(o.nameQualified, o.objectId))),
    };
};

export const deleteObjects = (state: PlanState, objects: PlanObjectID[]): PlanState => {
    const ids = [];
    const names = [];
    for (const oid of objects) {
        const o = state.objects.get(oid);
        ids.push(o.objectId);
        names.push(o.nameQualified);
    }
    return {
        ...state,
        objects: state.objects.deleteAll(ids),
        blobsByName: state.blobsByName.deleteAll(names),
        tablesByName: state.tablesByName.deleteAll(names),
    };
};

export const deleteObject = (state: PlanState, oid: PlanObjectID): PlanState => {
    const o = state.objects.get(oid);
    if (!o) return state;
    return {
        ...state,
        objects: state.objects.delete(oid),
        blobsByName: state.blobsByName.delete(o.nameQualified),
        tablesByName: state.tablesByName.delete(o.nameQualified),
    };
};

export const updateTable = (state: PlanState, name: string, update: Partial<TableSummary>): PlanState => {
    const tableID = state.tablesByName.get(name);
    if (!tableID) return state;
    const table = state.objects.get(tableID);
    if (!table || table.objectType != PlanObjectType.TABLE_SUMMARY) return state;
    const next = {
        ...(table as TableSummary),
        ...update,
    };
    return {
        ...state,
        objects: state.objects.set(next.objectId, next),
        tablesByName: state.tablesByName.set(next.nameQualified, next.objectId),
    };
};

export const resolveTableByName = (state: PlanState, name: string): TableSummary | null => {
    const tableID = state.tablesByName.get(name);
    if (tableID === undefined) return null;
    return (state.objects.get(tableID) as TableSummary) || null;
};

export const resolveBlobByName = (state: PlanState, name: string): UniqueBlob | null => {
    const blobID = state.blobsByName.get(name);
    if (blobID === undefined) return null;
    return (state.objects.get(blobID) as UniqueBlob) || null;
};

export const resolveCardById = (state: PlanState, id: number): CardSpecification | null => {
    const obj = state.objects.get(id);
    if (!obj || obj.objectType != PlanObjectType.CARD_SPECIFICATION) return null;
    return obj as CardSpecification;
};

export const forEachCard = (state: PlanState, callback: (card: CardSpecification, i: number) => void): void => {
    let i = 0;
    for (const [, v] of state.objects.entries()) {
        if (v.objectType == PlanObjectType.CARD_SPECIFICATION) {
            callback(v as CardSpecification, i++);
        }
    }
};
