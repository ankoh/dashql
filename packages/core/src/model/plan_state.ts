// Copyright (c) 2020 The DashQL Authors

import * as proto from '@dashql/proto';
import Immutable from 'immutable';
import { StatementStatus } from './program';
import { Card } from './card';
import { Table } from './table';
import { PlanObject, PlanObjectType, PlanObjectID } from './plan_object';
import { ActionHandle, ActionUpdate, Action } from './action';
import { deriveStatementStatusCode } from './program';

type ObjectID = number;
type TableName = string;

export interface PlanState {
    /// The status
    readonly status: Immutable.List<StatementStatus>;
    /// The blobs
    readonly objects: Immutable.Map<ObjectID, PlanObject>;
    /// The blobs
    readonly blobsByName: Immutable.Map<TableName, ObjectID>;
    /// The tables
    readonly tablesByName: Immutable.Map<TableName, ObjectID>;
    /// The plan actions
    readonly actions: Immutable.Map<ActionHandle, Action>;
}

export const createPlanState = (): PlanState => ({
    status: Immutable.List(),
    objects: Immutable.Map(),
    blobsByName: Immutable.Map(),
    tablesByName: Immutable.Map(),
    actions: Immutable.Map(),
});

export const resetStatus = (state: PlanState, status: StatementStatus[] = [], actions: Action[] = []): PlanState => ({
    ...state,
    status: Immutable.List(status),
    actions: Immutable.Map<ActionHandle, Action>(actions.map(a => [a.actionId, a])),
});

export const updateStatus = (state: PlanState, updates: ActionUpdate[]): PlanState => ({
    ...state,
    status: state.status.withMutations(status => {
        for (const update of updates) {
            const action = state.actions.get(update.actionId);
            if (!action || action.originStatement == null || action.statusCode == update.statusCode) {
                continue;
            }
            const origin = { ...status.get(action.originStatement)! };
            switch (action.statusCode) {
                case proto.action.ActionStatusCode.NONE:
                    break;
                case proto.action.ActionStatusCode.BLOCKED:
                    --origin.blockedActions;
                    break;
                case proto.action.ActionStatusCode.RUNNING:
                    --origin.runningActions;
                    break;
                case proto.action.ActionStatusCode.COMPLETED:
                    --origin.completedActions;
                    break;
                case proto.action.ActionStatusCode.FAILED:
                    --origin.failedActions;
            }
            switch (update.statusCode) {
                case proto.action.ActionStatusCode.NONE:
                    break;
                case proto.action.ActionStatusCode.BLOCKED:
                    ++origin.blockedActions;
                    break;
                case proto.action.ActionStatusCode.RUNNING:
                    ++origin.runningActions;
                    break;
                case proto.action.ActionStatusCode.COMPLETED:
                    ++origin.completedActions;
                    break;
                case proto.action.ActionStatusCode.FAILED:
                    ++origin.failedActions;
                    break;
            }
            origin.status = deriveStatementStatusCode(origin);
            status.set(action.originStatement, origin);
        }
    }),
    actions: state.actions.withMutations(actions => {
        const now = new Date();
        for (const update of updates) {
            const a = actions.get(update.actionId);
            if (!a) {
                console.warn(`UPDATE_PLAN_ACTIONS refers to unknown action id: ${update.actionId}`);
                continue;
            }
            actions.set(update.actionId, {
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
    const blobs = objects.filter(o => o.objectType == PlanObjectType.BLOB) as Card[];
    const tables = objects.filter(o => o.objectType == PlanObjectType.TABLE) as Table[];
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

export const updateTable = (state: PlanState, name: string, update: Partial<Table>): PlanState => {
    const tableID = state.tablesByName.get(name);
    if (!tableID) return state;
    const table = state.objects.get(tableID);
    if (!table || table.objectType != PlanObjectType.TABLE) return state;
    const next = {
        ...(table as Table),
        ...update,
    };
    return {
        ...state,
        objects: state.objects.set(next.objectId, next),
        tablesByName: state.tablesByName.set(next.nameQualified, next.objectId),
    };
};

export const resolveTableByName = (state: PlanState, name: string): Table | null => {
    const tableID = state.tablesByName.get(name);
    if (tableID === undefined) return null;
    return (state.objects.get(tableID) as Table) || null;
};

export const resolveCardById = (state: PlanState, id: number): Card | null => {
    const obj = state.objects.get(id);
    if (!obj || obj.objectType != PlanObjectType.CARD) return null;
    return obj as Card;
};

export const forEachCard = (state: PlanState, callback: (card: Card, i: number) => void): void => {
    let i = 0;
    for (const [, v] of state.objects.entries()) {
        if (v.objectType == PlanObjectType.CARD) {
            callback(v as Card, i++);
        }
    }
};

export const collectCards = (state: PlanState): Map<number, Card> => {
    const cards: Map<number, Card> = new Map();
    forEachCard(state, c => cards.set(c.objectId, c));
    return cards;
};
