import * as proto from '@dashql/proto';
import * as utils from '../utils';
import * as plan_state from './plan_state';
import { LogEntryVariant } from './log';
import { Plan } from './plan';
import { Action, ActionUpdate, ActionSchedulerStatus } from './action';
import { PlanObjectID, PlanObject, PlanObjectType } from './plan_object';
import { Script } from './script';
import { Table } from './table';
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
    REPLACE_SCRIPT = 'REPLACE_SCRIPT',
    UPDATE_SCRIPT = 'UPDATE_SCRIPT',
    SET_PROGRAM = 'SET_PROGRAM',
    SET_PROGRAM_INSTANCE = 'SET_PROGRAM_INSTANCE',
    REWRITE_PROGRAM = 'REWRITE_PROGRAM',
    UPDATE_PLAN_ACTIONS = 'UPDATE_PLAN_ACTIONS',
    INSERT_PLAN_OBJECTS = 'INSERT_PLAN_OBJECTS',
    DELETE_PLAN_OBJECTS = 'DELETE_PLAN_OBJECTS',
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
    | StateMutation<StateMutationType.UPDATE_SCRIPT, Script>
    | StateMutation<StateMutationType.REPLACE_SCRIPT, Script>
    | StateMutation<StateMutationType.SET_PROGRAM, Program>
    | StateMutation<StateMutationType.SET_PROGRAM_INSTANCE, ProgramInstance>
    | StateMutation<StateMutationType.REWRITE_PROGRAM, ProgramInstance>
    | StateMutation<StateMutationType.UPDATE_PLAN_ACTIONS, ActionUpdate[]>
    | StateMutation<StateMutationType.INSERT_PLAN_OBJECTS, PlanObject[]>
    | StateMutation<StateMutationType.DELETE_PLAN_OBJECTS, PlanObjectID[]>
    | StateMutation<StateMutationType.UPDATE_TABLE_INFO, [string, Partial<Table>]>
    | StateMutation<StateMutationType.CACHE_FILE_DATA, [CachedFileData, string | null]>
    | StateMutation<StateMutationType.CACHE_HTTP_DATA, [CachedHTTPData, string | null]>
    | StateMutation<StateMutationType.HIT_CACHED_FILE_DATA, string>
    | StateMutation<StateMutationType.HIT_CACHED_HTTP_DATA, string>;

export type StateMutationDispatcher = (mutation: StateMutationVariant) => void;

// The action dispatch
export type Dispatch = (mutation: StateMutationVariant) => void;
// Mutate the store
export function mutate(dispatch: Dispatch, m: StateMutationVariant): void {
    return dispatch(m);
}

function reduceImpl(state: CoreState, mutation: StateMutationVariant): CoreState {
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
                planState: plan_state.resetStatus(state.planState),
            };
        }

        case StateMutationType.SCHEDULE_PLAN: {
            const status: StatementStatus[] = [];
            for (let i = 0; i < state.program!.buffer.statementsLength(); ++i) {
                status.push({
                    status: proto.action.ActionStatusCode.PENDING,
                    totalActions: 0,
                    totalPerStatus: [0, 0, 0, 0, 0, 0],
                });
            }
            mutation.data[1].forEach(a => {
                if (a.originStatement != null) {
                    ++status[a.originStatement].totalActions;
                    ++status[a.originStatement].totalPerStatus[a.statusCode as number];
                }
            });
            for (const s of status) {
                s.status = deriveStatementStatusCode(s);
            }
            return {
                ...state,
                schedulerStatus: ActionSchedulerStatus.Working,
                plan: mutation.data[0],
                planState: plan_state.resetStatus(state.planState, status, mutation.data[1]),
            };
        }

        case StateMutationType.SCHEDULER_READY:
            return {
                ...state,
                schedulerStatus: ActionSchedulerStatus.Idle,
            };

        case StateMutationType.UPDATE_SCRIPT:
            return {
                ...state,
                script: mutation.data,
            };

        case StateMutationType.REPLACE_SCRIPT:
            return {
                ...state,
                script: mutation.data,
                planState: {
                    ...state.planState,
                    objects: state.planState.objects.map((o, k) =>
                        o.objectType == PlanObjectType.CARD
                            ? {
                                  ...o,
                                  visible: false,
                              }
                            : o,
                    ),
                },
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
                planState: plan_state.updateStatus(state.planState, mutation.data),
            };
        }

        case StateMutationType.INSERT_PLAN_OBJECTS:
            return {
                ...state,
                planState: plan_state.insertObjects(state.planState, mutation.data),
            };

        case StateMutationType.DELETE_PLAN_OBJECTS:
            return {
                ...state,
                planState: plan_state.deleteObjects(state.planState, mutation.data),
            };

        case StateMutationType.UPDATE_TABLE_INFO:
            return {
                ...state,
                planState: plan_state.updateTable(state.planState, mutation.data[0], mutation.data[1]),
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

export class StateMutations {
    public static reduce(state: CoreState, mutation: StateMutationVariant): CoreState {
        return reduceImpl(state, mutation);
    }
}
