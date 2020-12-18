import * as Immutable from "immutable";
import { LogEntry } from "./log";
import { Plan } from "./plan";
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
    INSERT_PLAN_OBJECTS     = 'INSERT_PLAN_OBJECTS',
    DELETE_PLAN_OBJECTS     = 'DELETE_PLAN_OBJECTS',
    DELETE_PLAN             = 'DELETE_PLAN',
    OTHER                   = 'OTHER',
}

/// A mutation variant
export type StateMutationVariant =
      StateMutation<StateMutationType.LOG_PUSH_ENTRY, LogEntry>
    | StateMutation<StateMutationType.SET_PROGRAM, [string, Program]>
    | StateMutation<StateMutationType.SET_PLAN, Plan>
    | StateMutation<StateMutationType.INSERT_PLAN_OBJECTS, PlanObject[]>
    | StateMutation<StateMutationType.DELETE_PLAN_OBJECTS, PlanObjectID[]>
    | StateMutation<StateMutationType.DELETE_PLAN, {}>
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
        return { type: StateMutationType.DELETE_PLAN, payload: {} };
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
                    plan: mutation.payload
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
            case StateMutationType.DELETE_PLAN:
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
