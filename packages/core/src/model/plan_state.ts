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
    /// The cards
    readonly cards: Immutable.Map<ObjectID, Card>;
    /// The database tables
    readonly tables: Immutable.Map<TableName, Table>;
    /// The plan actions
    readonly actions: Immutable.Map<ActionHandle, Action>;
}

export const createPlanState = (): PlanState => ({
    actions: Immutable.Map(),
    status: Immutable.List(),
    cards: Immutable.Map(),
    tables: Immutable.Map(),
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

export const insertObjects = (state: PlanState, objects: PlanObject[]): PlanState => ({
    ...state,
    cards: state.cards.withMutations(os => {
        for (const o of objects) {
            if (o.objectType == PlanObjectType.CARD) {
                const t = o as Card;
                os.set(t.objectId, t);
            }
        }
    }),
    tables: state.tables.withMutations(os => {
        for (const o of objects) {
            if (o.objectType == PlanObjectType.DATABASE_TABLE) {
                const t = o as Table;
                os.set(t.tableNameQualified, t);
            }
        }
    }),
});

export const deleteObjects = (state: PlanState, objects: PlanObjectID[]): PlanState => ({
    ...state,
    tables: state.tables.deleteAll(objects.map(k => k.toString())),
    cards: state.cards.deleteAll(objects),
});

export const deleteTable = (state: PlanState, key: string): PlanState => ({
    ...state,
    tables: state.tables.delete(key),
});

export const updateTable = (state: PlanState, tableName: string, update: Partial<Table>): PlanState => {
    const table = state.tables.get(tableName);
    if (!table) return state;
    const next = {
        ...table,
        ...update,
    };
    return {
        ...state,
        tables: state.tables.set(tableName, next),
    };
};
