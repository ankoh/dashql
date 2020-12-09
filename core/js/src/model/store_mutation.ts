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
    CLEAR_PLAN              = 'CLEAR_PLAN',
    OTHER                   = 'OTHER',
}

/// An action variant
export type ActionVariant =
    | Action<ActionType.SET_PROGRAM, Program>
    | Action<ActionType.SET_PLAN, Plan>
    | Action<ActionType.CLEAR_PLAN, {}>
    ;

/// Mutation of the application state
export class StateMutations {

}
