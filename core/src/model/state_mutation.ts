import * as Immutable from 'immutable';
import * as proto from '@dashql/proto';
import * as utils from '../utils';
import { LogEntryVariant } from './log';
import { Plan } from './plan';
import { ActionHandle, Action, ActionUpdate, ActionSchedulerStatus } from './action';
import { DatabaseTableInfo } from './database_info';
import { PlanObjectID, PlanObject, PlanObjectType } from './plan_object';
import { Script } from './script';
import { Program, StatementStatus, deriveStatementStatusCode } from './program';
import { ProgramInstance } from './program_instance';
import { CoreState } from './state';
import { CachedFileData, CachedHTTPData } from './cache';

const MAX_LOG_SIZE = 100;

/// A mutation
export type StateMutation<T, P> = {
    readonly type: T;
    readonly data: P;
};

/// A mutation type
export enum StateMutationType {
    LOG_PUSH_ENTRY = 'LOG_PUSH_ENTRY',
    SCHEDULER_READY = 'SCHEDULER_READY',
    SCHEDULE_PLAN = 'SCHEDULE_PLAN',
    RESET_PLAN = 'RESET_PLAN',
    SET_SCRIPT = 'SET_SCRIPT',
    SET_PROGRAM = 'SET_PROGRAM',
    SET_PROGRAM_INSTANCE = 'SET_PROGRAM_INSTANCE',
    REWRITE_PROGRAM = 'REWRITE_PROGRAM',
    UPDATE_PLAN_ACTIONS = 'UPDATE_PLAN_ACTIONS',
    INSERT_PLAN_OBJECTS = 'INSERT_PLAN_OBJECTS',
    DELETE_PLAN_OBJECTS = 'DELETE_PLAN_OBJECTS',
    DELETE_TABLE_INFO = 'DELETE_TABLE_INFO',
    UPDATE_TABLE_INFO = 'UPDATE_TABLE_INFO',
    CACHE_HTTP_DATA = 'CACHE_HTTP_DATA',
    CACHE_FILE_DATA = 'CACHE_FILE_DATA',
    HIT_CACHED_HTTP_DATA = 'HIT_CACHED_HTTP_DATA',
    HIT_CACHED_FILE_DATA = 'HIT_CACHED_FILE_DATA',
    OTHER = 'OTHER',
}

/// A mutation variant
export type StateMutationVariant =
    | StateMutation<StateMutationType.LOG_PUSH_ENTRY, LogEntryVariant>
    | StateMutation<StateMutationType.SCHEDULER_READY, null>
    | StateMutation<StateMutationType.SCHEDULE_PLAN, [Plan, Action[]]>
    | StateMutation<StateMutationType.RESET_PLAN, null>
    | StateMutation<StateMutationType.SET_SCRIPT, Script>
    | StateMutation<StateMutationType.SET_PROGRAM, Program>
    | StateMutation<StateMutationType.SET_PROGRAM_INSTANCE, ProgramInstance>
    | StateMutation<StateMutationType.REWRITE_PROGRAM, ProgramInstance>
    | StateMutation<StateMutationType.UPDATE_PLAN_ACTIONS, ActionUpdate[]>
    | StateMutation<StateMutationType.INSERT_PLAN_OBJECTS, PlanObject[]>
    | StateMutation<StateMutationType.DELETE_PLAN_OBJECTS, PlanObjectID[]>
    | StateMutation<StateMutationType.DELETE_TABLE_INFO, string>
    | StateMutation<StateMutationType.UPDATE_TABLE_INFO, [string, Partial<DatabaseTableInfo>]>
    | StateMutation<StateMutationType.CACHE_FILE_DATA, [CachedFileData, string | null]>
    | StateMutation<StateMutationType.CACHE_HTTP_DATA, [CachedHTTPData, string | null]>
    | StateMutation<StateMutationType.HIT_CACHED_FILE_DATA, string>
    | StateMutation<StateMutationType.HIT_CACHED_HTTP_DATA, string>;

export type StateMutationDispatcher = (mutation: StateMutationVariant) => void;

// The action dispatch
export type Dispatch = (mutation: StateMutationVariant) => void;
// Mutate the store
export function mutate(dispatch: Dispatch, m: StateMutationVariant) {
    return dispatch(m);
}

export class StateMutations {
    public static reduce(state: CoreState, mutation: StateMutationVariant): CoreState {
        switch (mutation.type) {
            case StateMutationType.LOG_PUSH_ENTRY:
                return {
                    ...state,
                    logEntries: state.logEntries.withMutations(list => {
                        list.unshift(mutation.data);
                        if (list.size > MAX_LOG_SIZE) {
                            list.pop();
                        }
                    }),
                };

            case StateMutationType.RESET_PLAN: {
                if (state.schedulerStatus !== ActionSchedulerStatus.Idle) {
                    return state;
                }
                return {
                    ...state,
                    schedulerStatus: ActionSchedulerStatus.Idle,
                    plan: null,
                    planProgramStatus: Immutable.List<StatementStatus>(),
                    planActions: Immutable.Map<ActionHandle, Action>(),
                };
            }

            case StateMutationType.SCHEDULE_PLAN: {
                const stmt: StatementStatus[] = [];
                for (let i = 0; i < state.program!.buffer.statementsLength(); ++i) {
                    stmt.push({
                        status: proto.action.ActionStatusCode.NONE,
                        totalActions: 0,
                        runningActions: 0,
                        blockedActions: 0,
                        failedActions: 0,
                        completedActions: 0,
                    });
                }
                mutation.data[1].forEach(a => {
                    if (a.originStatement != null) {
                        ++stmt[a.originStatement].totalActions;

                        // Already done?
                        // This may happen on import.
                        if (a.statusCode == proto.action.ActionStatusCode.COMPLETED) {
                            ++stmt[a.originStatement].completedActions;
                        }
                    }
                });
                for (const s of stmt) {
                    s.status = deriveStatementStatusCode(s);
                }
                return {
                    ...state,
                    schedulerStatus: ActionSchedulerStatus.Working,
                    plan: mutation.data[0],
                    planProgramStatus: Immutable.List<StatementStatus>(stmt),
                    planActions: Immutable.Map<ActionHandle, Action>(mutation.data[1].map(a => [a.actionId, a])),
                };
            }

            case StateMutationType.SCHEDULER_READY:
                return {
                    ...state,
                    schedulerStatus: ActionSchedulerStatus.Idle,
                };

            case StateMutationType.SET_SCRIPT:
                return {
                    ...state,
                    script: mutation.data,
                };

            case StateMutationType.SET_PROGRAM:
                return {
                    ...state,
                    program: mutation.data,
                };

            case StateMutationType.SET_PROGRAM_INSTANCE:
                return {
                    ...state,
                    programInstance: mutation.data,
                };

            case StateMutationType.REWRITE_PROGRAM:
                return {
                    ...state,
                    script: {
                        ...state.script,
                        modified: true,
                        text: mutation.data.program.text,
                        lineCount: utils.countLines(mutation.data.program.text),
                        bytes: utils.estimateUTF16Length(mutation.data.program.text),
                    },
                    program: mutation.data.program,
                    programInstance: mutation.data,
                };

            case StateMutationType.UPDATE_PLAN_ACTIONS: {
                return {
                    ...state,
                    planProgramStatus: state.planProgramStatus.withMutations(status => {
                        for (const update of mutation.data) {
                            const action = state.planActions.get(update.actionId);
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
                    planActions: state.planActions.withMutations(actions => {
                        let now = new Date();
                        for (const update of mutation.data) {
                            let a = actions.get(update.actionId);
                            if (!a) {
                                console.warn('UPDATE_ACTIONS refers to unknown action id: ' + update.actionId);
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
                };
            }

            case StateMutationType.INSERT_PLAN_OBJECTS:
                return {
                    ...state,
                    planObjects: state.planObjects.withMutations(os => {
                        for (const o of mutation.data) {
                            os.set(o.objectId.toString(), o);
                        }
                    }),
                    planDatabaseTables: state.planDatabaseTables.withMutations(os => {
                        for (const o of mutation.data) {
                            if (o.objectType == PlanObjectType.DATABASE_TABLE_INFO) {
                                const t = o as DatabaseTableInfo;
                                os.set(t.tableNameQualified, t);
                            }
                        }
                    }),
                };

            case StateMutationType.DELETE_PLAN_OBJECTS:
                return {
                    ...state,
                    planObjects: state.planObjects.withMutations(os => {
                        os.deleteAll(mutation.data.map(k => k.toString()));
                    }),
                };

            case StateMutationType.DELETE_TABLE_INFO: {
                const info = state.planDatabaseTables.get(mutation.data);
                if (!info) {
                    return state;
                }
                const objectID = info.objectId;
                return {
                    ...state,
                    planObjects: state.planObjects.delete(objectID.toString()),
                    planDatabaseTables: state.planDatabaseTables.delete(mutation.data),
                };
            }

            case StateMutationType.UPDATE_TABLE_INFO: {
                const table = state.planDatabaseTables.get(mutation.data[0]);
                if (!table) return state;
                const next = {
                    ...table,
                    ...mutation.data[1],
                };
                const key = table.objectId.toString();
                return {
                    ...state,
                    planObjects: state.planObjects.set(key, next),
                    planDatabaseTables: state.planDatabaseTables.set(table.tableNameQualified, next),
                };
            }

            case StateMutationType.CACHE_FILE_DATA:
                return {
                    ...state,
                    cachedFileData: state.cachedFileData.withMutations(c => {
                        const [next, evict] = mutation.data;
                        if (evict != null) {
                            const v = c.get(evict);
                            c.delete(evict);
                            if (v !== undefined) {
                                URL.revokeObjectURL(v.objectURL);
                            }
                        }
                        c.set(next.key, next);
                    }),
                };

            case StateMutationType.CACHE_HTTP_DATA:
                return {
                    ...state,
                    cachedHTTPData: state.cachedHTTPData.withMutations(c => {
                        const [next, evict] = mutation.data;
                        if (evict != null) {
                            c.delete(evict);
                        }
                        c.set(next.key, next);
                    }),
                };

            case StateMutationType.HIT_CACHED_FILE_DATA:
                return {
                    ...state,
                    cachedFileData: state.cachedFileData.withMutations(c => {
                        const e = c.get(mutation.data);
                        if (!e) return;
                        c.set(e.key, {
                            ...e,
                            timeLastAccess: new Date(),
                            accessCount: ++e.accessCount,
                        });
                    }),
                };

            case StateMutationType.HIT_CACHED_HTTP_DATA:
                return {
                    ...state,
                    cachedHTTPData: state.cachedHTTPData.withMutations(c => {
                        const e = c.get(mutation.data);
                        if (!e) return;
                        c.set(e.key, {
                            ...e,
                            timeLastAccess: new Date(),
                            accessCount: ++e.accessCount,
                        });
                    }),
                };

            default:
                return state;
        }
    }
}
