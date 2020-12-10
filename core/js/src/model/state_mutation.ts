import { DashQLCoreBindings } from "../core_bindings";
import { State } from "./state";
import { Plan } from "./plan";
import { Program } from "./program";

/// An action
export type Action<T, P> = {
    readonly type: T;
    readonly payload: P;
}

/// An action type
export enum ActionType {
    SET_PROGRAM             = 'SET_PROGRAM',
    SET_PLAN                = 'SET_PLAN',
    ADD_PLAN_OBJECTS        = 'ADD_PLAN_OBJECTS',
    DELETE_PLAN_OBJECTS     = 'DELETE_PLAN_OBJECTS',
    DELETE_PLAN             = 'DELETE_PLAN',
    OTHER                   = 'OTHER',
}

/// An action variant
export type ActionVariant =
    | Action<ActionType.SET_PROGRAM, Program>
    | Action<ActionType.SET_PLAN, Plan>
    | Action<ActionType.DELETE_PLAN, {}>
    ;

export class StateMutation {
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
        _core: DashQLCoreBindings
    ): S {
        switch (action.type) {
            case ActionType.SET_PROGRAM:
                return {
                    ...state,
                    core: {
                        ...state.core,
                        program: action.payload
                    }
                };
            case ActionType.SET_PLAN:
                return {
                    ...state,
                    core: {
                        ...state.core,
                        plan: action.payload
                    }
                };
            case ActionType.DELETE_PLAN:
                return {
                    ...state,
                    core: {
                        ...state.core,
                        plan: null 
                    }
                };
            default:
                return state;
        }
    }
}
