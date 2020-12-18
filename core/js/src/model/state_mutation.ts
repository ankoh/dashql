import * as proto from "@dashql/proto";
import * as Immutable from "immutable";
import { LogEntry } from "./log";
import { Plan } from "./plan";
import { ActionID, Action, ActionUpdate, ActionLogEntry } from "./action";
import { PlanObjectID, PlanObject } from "./plan_object";
import { Program } from "./program";
import { CoreState } from "./state";

const MAX_LOG_SIZE = 100;

/// A mutation
export type StateMutation<T, P> = {
    readonly type: T;
    readonly payload: P;
}

/// A mutation type
export enum StateMutationType {
    LOG_PUSH_ENTRY          = 'LOG_PUSH_ENTRY',
    SET_PROGRAM             = 'SET_PROGRAM',
    SET_PLAN                = 'SET_PLAN',
    SET_PLAN_ACTIONS        = 'SET_PLAN_ACTIONS',
    UPDATE_PLAN_ACTIONS     = 'UPDATE_PLAN_ACTIONS',
    INSERT_PLAN_OBJECTS     = 'INSERT_PLAN_OBJECTS',
    DELETE_PLAN_OBJECTS     = 'DELETE_PLAN_OBJECTS',
    OTHER                   = 'OTHER',
}

/// A mutation variant
export type StateMutationVariant =
      StateMutation<StateMutationType.LOG_PUSH_ENTRY, LogEntry>
    | StateMutation<StateMutationType.SET_PROGRAM, [string, Program]>
    | StateMutation<StateMutationType.SET_PLAN, Plan | null>
    | StateMutation<StateMutationType.SET_PLAN_ACTIONS, Action[]>
    | StateMutation<StateMutationType.UPDATE_PLAN_ACTIONS, ActionUpdate[]>
    | StateMutation<StateMutationType.INSERT_PLAN_OBJECTS, PlanObject[]>
    | StateMutation<StateMutationType.DELETE_PLAN_OBJECTS, PlanObjectID[]>
    ;

export type StateMutationDispatcher = (mutation: StateMutationVariant) => void;

export class StateMutations {
    public static pushLogEntry(log: LogEntry): StateMutationVariant {
        return { type: StateMutationType.LOG_PUSH_ENTRY, payload: log };
    }

    public static setProgram(program_text: string, program: Program): StateMutationVariant {
        return { type: StateMutationType.SET_PROGRAM, payload: [program_text, program] };
    }

    public static setPlan(plan: Plan): StateMutationVariant {
        return { type: StateMutationType.SET_PLAN, payload: plan };
    }

    public static clearPlan(): StateMutationVariant {
        return { type: StateMutationType.SET_PLAN, payload: null };
    }

    public static reduce(
        state: CoreState,
        mutation: StateMutationVariant,
    ): CoreState {
        switch (mutation.type) {
            case StateMutationType.LOG_PUSH_ENTRY:
                return {
                    ...state,
                    logEntries: state.logEntries.withMutations(list => {
                        list.unshift(mutation.payload);
                        if (list.size > MAX_LOG_SIZE) {
                            list.pop();
                        }
                    }),
                };
            case StateMutationType.SET_PROGRAM:
                return {
                    ...state,
                    programText: mutation.payload[0],
                    program: mutation.payload[1]
                };
            case StateMutationType.SET_PLAN:
                return {
                    ...state,
                    plan: mutation.payload,
                    planActions: Immutable.Map<ActionID, Action>(),
                    planActionLog: Immutable.List<ActionLogEntry>(),
                };
            case StateMutationType.SET_PLAN_ACTIONS:
                return {
                    ...state,
                    planActions: Immutable.Map<ActionID, Action>(mutation.payload.map(a => [a.actionId, a]))
                };
            case StateMutationType.UPDATE_PLAN_ACTIONS:
                return {
                    ...state,
                    planActions: state.planActions.withMutations(actions => {
                        let now = new Date();
                        for (const update of mutation.payload) {
                            let a = actions.get(update.actionId);
                            if (!a) {
                                console.warn("UPDATE_ACTIONS refers to unknown action id: " + update.actionId);
                                continue;
                            }
                            actions.set(update.actionId, {
                                ...a,
                                statusCode: update.statusCode,
                                blocker: update.blocker,
                                timeScheduled: a.timeCreated || now,
                                timeLastUpdate: now,
                                errorMessage: update.errorMessage
                            });
                        }
                    })
                };
            case StateMutationType.INSERT_PLAN_OBJECTS:
                return {
                    ...state,
                    planObjects: state.planObjects.withMutations(os => {
                        for (const o of mutation.payload) {
                            os.set(o.objectId, o);
                        }
                    })
                };
            case StateMutationType.DELETE_PLAN_OBJECTS:
                return {
                    ...state,
                    planObjects: state.planObjects.withMutations(os => {
                        os.deleteAll(mutation.payload);
                    })
                };
            default:
                return state;
        }
    }
}
