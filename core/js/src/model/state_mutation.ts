import * as Immutable from "immutable";
import { DashQLCoreBindings } from "../core_bindings";
import { LogEntry } from "./log";
import { Plan } from "./plan";
import { PlanObjectID, PlanObject } from "./plan_object";
import { Program } from "./program";
import { State } from "./state";

const MAX_LOG_SIZE = 100;

/// An action
export type Action<T, P> = {
    readonly type: T;
    readonly payload: P;
}

/// An action type
export enum ActionType {
    LOG_PUSH_ENTRY          = 'LOG_PUSH_ENTRY',
    SET_PROGRAM             = 'SET_PROGRAM',
    SET_PLAN                = 'SET_PLAN',
    INSERT_PLAN_OBJECTS     = 'INSERT_PLAN_OBJECTS',
    DELETE_PLAN_OBJECTS     = 'DELETE_PLAN_OBJECTS',
    DELETE_PLAN             = 'DELETE_PLAN',
    OTHER                   = 'OTHER',
}

/// An action variant
export type ActionVariant =
      Action<ActionType.LOG_PUSH_ENTRY, LogEntry>
    | Action<ActionType.SET_PROGRAM, Program>
    | Action<ActionType.SET_PLAN, Plan>
    | Action<ActionType.INSERT_PLAN_OBJECTS, PlanObject[]>
    | Action<ActionType.DELETE_PLAN_OBJECTS, PlanObjectID[]>
    | Action<ActionType.DELETE_PLAN, {}>
    ;

export type StateMutationDispatch = (action: ActionVariant) => void;

export class StateMutation {
    public static pushLogEntry(log: LogEntry): ActionVariant {
        return { type: ActionType.LOG_PUSH_ENTRY, payload: log };
    }

    public static setProgram(program: Program): ActionVariant {
        return { type: ActionType.SET_PROGRAM, payload: program };
    }

    public static setPlan(plan: Plan): ActionVariant {
        return { type: ActionType.SET_PLAN, payload: plan };
    }

    public static clearPlan(): ActionVariant {
        return { type: ActionType.DELETE_PLAN, payload: {} };
    }

    public static reduce<S extends State>(
        state: S,
        action: ActionVariant,
        core: DashQLCoreBindings
    ): S {
        switch (action.type) {
            case ActionType.LOG_PUSH_ENTRY:
                return {
                    ...state,
                    logEntries: state.logEntries.withMutations(list => {
                        list.unshift(action.payload);
                        if (list.size > MAX_LOG_SIZE) {
                            list.pop();
                        }
                    }),
                };
            case ActionType.SET_PROGRAM:
                return {
                    ...state,
                    program: action.payload
                };
            case ActionType.SET_PLAN:
                return {
                    ...state,
                    plan: action.payload
                };
            case ActionType.INSERT_PLAN_OBJECTS:
                return {
                    ...state,
                    planObjects: state.planObjects.withMutations(os => {
                        for (const o of action.payload) {
                            const mem = os.get(o.object_id)?.core_memory;
                            if (mem) {
                                core.free(mem.address, mem.size);
                            }
                            os.set(o.object_id, o);
                        }
                    })
                };
            case ActionType.DELETE_PLAN_OBJECTS:
                return {
                    ...state,
                    planObjects: state.planObjects.withMutations(os => {
                        for (const id of action.payload) {
                            const mem = os.get(id)?.core_memory;
                            if (mem) {
                                core.free(mem.address, mem.size);
                            }
                        }
                        os.deleteAll(action.payload);
                    })
                };
            case ActionType.DELETE_PLAN:
                state.planObjects.forEach(o => {
                    const mem = o.core_memory;
                    if (mem) {
                        core.free(mem.address, mem.size);
                    }
                });
                return {
                    ...state,
                    plan: null,
                    planObjects: Immutable.Map<PlanObjectID, PlanObject>(),
                };
            default:
                return state;
        }
    }
}
