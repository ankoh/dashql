import * as Immutable from "immutable";
import { LogEntry } from "./log";
import { Plan } from "./plan";
import { PlanObjectID, PlanObject } from "./plan_object";
import { Program } from "./program";
import { CoreState } from "./state";

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
    | Action<ActionType.SET_PROGRAM, [string, Program]>
    | Action<ActionType.SET_PLAN, Plan>
    | Action<ActionType.INSERT_PLAN_OBJECTS, PlanObject[]>
    | Action<ActionType.DELETE_PLAN_OBJECTS, PlanObjectID[]>
    | Action<ActionType.DELETE_PLAN, {}>
    ;

export type StateMutationDispatcher = (action: ActionVariant) => void;

export class StateMutation {
    public static pushLogEntry(log: LogEntry): ActionVariant {
        return { type: ActionType.LOG_PUSH_ENTRY, payload: log };
    }

    public static setProgram(program_text: string, program: Program): ActionVariant {
        return { type: ActionType.SET_PROGRAM, payload: [program_text, program] };
    }

    public static setPlan(plan: Plan): ActionVariant {
        return { type: ActionType.SET_PLAN, payload: plan };
    }

    public static clearPlan(): ActionVariant {
        return { type: ActionType.DELETE_PLAN, payload: {} };
    }

    public static reduce(
        state: CoreState,
        action: ActionVariant,
    ): CoreState {
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
                    programText: action.payload[0],
                    program: action.payload[1]
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
                            os.set(o.objectId, o);
                        }
                    })
                };
            case ActionType.DELETE_PLAN_OBJECTS:
                return {
                    ...state,
                    planObjects: state.planObjects.withMutations(os => {
                        os.deleteAll(action.payload);
                    })
                };
            case ActionType.DELETE_PLAN:
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
