import * as Immutable from "immutable";
import { DashQLCoreBindings } from "../core_bindings";
import { State } from "./state";
import { Plan } from "./plan";
import { PlanObjectID, PlanObject } from "./plan_object";
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
    | Action<ActionType.ADD_PLAN_OBJECTS, PlanObject[]>
    | Action<ActionType.DELETE_PLAN_OBJECTS, PlanObjectID[]>
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
        core: DashQLCoreBindings
    ): S {
        switch (action.type) {
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
            case ActionType.ADD_PLAN_OBJECTS:
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
