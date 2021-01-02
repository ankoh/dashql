import * as Immutable from 'immutable';
import * as proto from '@dashql/proto';
import { LogEntry } from './log';
import { Plan } from './plan';
import { ActionID, Action, ActionUpdate, ActionLogEntry, ActionSchedulerStatus } from './action';
import { PlanObjectID, PlanObject } from './plan_object';
import { Program, StatementStatus, deriveStatementStatusCode } from './program';
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
    SET_PROGRAM = 'SET_PROGRAM',
    SET_PROGRAM_TEXT = 'SET_PROGRAM_TEXT',
    UPDATE_PLAN_ACTIONS = 'UPDATE_PLAN_ACTIONS',
    INSERT_PLAN_OBJECTS = 'INSERT_PLAN_OBJECTS',
    DELETE_PLAN_OBJECTS = 'DELETE_PLAN_OBJECTS',
    CACHE_HTTP_DATA = 'CACHE_HTTP_DATA',
    CACHE_FILE_DATA = 'CACHE_FILE_DATA',
    HIT_CACHED_HTTP_DATA = 'HIT_CACHED_HTTP_DATA',
    HIT_CACHED_FILE_DATA = 'HIT_CACHED_FILE_DATA',
    OTHER = 'OTHER',
}

/// A mutation variant
export type StateMutationVariant =
    | StateMutation<StateMutationType.LOG_PUSH_ENTRY, LogEntry>
    | StateMutation<StateMutationType.SCHEDULER_READY, null>
    | StateMutation<StateMutationType.SCHEDULE_PLAN, [Plan, Action[]]>
    | StateMutation<StateMutationType.SET_PROGRAM, Program>
    | StateMutation<StateMutationType.SET_PROGRAM_TEXT, string>
    | StateMutation<StateMutationType.UPDATE_PLAN_ACTIONS, ActionUpdate[]>
    | StateMutation<StateMutationType.INSERT_PLAN_OBJECTS, PlanObject[]>
    | StateMutation<StateMutationType.DELETE_PLAN_OBJECTS, PlanObjectID[]>
    | StateMutation<StateMutationType.CACHE_FILE_DATA, [CachedFileData, string | null]>
    | StateMutation<StateMutationType.CACHE_HTTP_DATA, [CachedHTTPData, string | null]>
    | StateMutation<StateMutationType.HIT_CACHED_FILE_DATA, string>
    | StateMutation<StateMutationType.HIT_CACHED_HTTP_DATA, string>
    ;

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
                    }
                });
                return {
                    ...state,
                    programStatus: Immutable.List<StatementStatus>(stmt),
                    schedulerStatus: ActionSchedulerStatus.Working,
                    plan: mutation.data[0],
                    planActions: Immutable.Map<ActionID, Action>(mutation.data[1].map(a => [a.actionId, a])),
                    planActionLog: Immutable.List<ActionLogEntry>(),
                };
            }

            case StateMutationType.SCHEDULER_READY:
                return {
                    ...state,
                    schedulerStatus: ActionSchedulerStatus.Idle,
                };

            case StateMutationType.SET_PROGRAM_TEXT:
                return {
                    ...state,
                    programText: mutation.data,
                };

            case StateMutationType.SET_PROGRAM:
                return {
                    ...state,
                    program: mutation.data,
                    programStatus: Immutable.List<StatementStatus>(),
                };

            case StateMutationType.UPDATE_PLAN_ACTIONS: {
                return {
                    ...state,
                    programStatus: state.programStatus.withMutations(status => {
                        for (const update of mutation.data) {
                            const action = state.planActions.get(update.actionId);
                            if (!action || action.originStatement == null || action.statusCode == update.statusCode) {
                                continue;
                            }
                            const origin = {...status.get(action.originStatement)!};
                            switch (action.statusCode) {
                                case proto.action.ActionStatusCode.BLOCKED:
                                    --origin.blockedActions;
                                    break;
                                case proto.action.ActionStatusCode.RUNNING:
                                    --origin.runningActions;
                                    break;
                                case proto.action.ActionStatusCode.COMPLETED:
                                case proto.action.ActionStatusCode.FAILED:
                                case proto.action.ActionStatusCode.NONE:
                                    break;
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
                            os.set(o.objectId, o);
                        }
                    }),
                };

            case StateMutationType.DELETE_PLAN_OBJECTS:
                return {
                    ...state,
                    planObjects: state.planObjects.withMutations(os => {
                        os.deleteAll(mutation.data);
                    }),
                };

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
                    })
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
                    })
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
                            accessCount: ++e.accessCount
                        });
                    })
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
                            accessCount: ++e.accessCount
                        });
                    })
                };

            default:
                return state;
        }
    }
}
