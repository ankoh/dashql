import * as core from "@dashql/core";
import { LogEntry } from "./log";
import { AppState } from "./app_state";
import { AppSettings } from "./app_settings";

const MAX_LOG_SIZE = 100;

/// An action
export type Action<T, P> = {
    readonly type: T;
    readonly payload: P;
}

/// An action type
export enum ActionType {
    CONFIGURE_APP           = 'CONFIGURE_APP',
    LOG_PUSH_ENTRY          = 'LOG_PUSH_ENTRY',
    SET_PLAN                = 'SET_PLAN',
    SET_PLAN_TEXT           = 'SET_PLAN_TEXT',
    CLEAR_PLAN              = 'CLEAR_PLAN',
    OTHER                   = 'OTHER',
}

/// An action variant
export type ActionVariant =
    | Action<ActionType.CONFIGURE_APP, AppSettings>
    | Action<ActionType.LOG_PUSH_ENTRY, LogEntry>
    | Action<ActionType.SET_PLAN_TEXT, string>
    | Action<ActionType.SET_PLAN, core.Plan>
    | Action<ActionType.CLEAR_PLAN, {}>
    ;

/// Mutation of the application state
export class AppStateMutations {
    /// Configure the application
    public static configureApp(config: AppSettings): ActionVariant {
        return { type: ActionType.CONFIGURE_APP, payload: config };
    }

    /// Push a log entry
    public static pushLogEntry(log: LogEntry): ActionVariant {
        return { type: ActionType.LOG_PUSH_ENTRY, payload: log };
    }

    /// Set the editor text
    public static setPlanText(text: string): ActionVariant {
        return { type: ActionType.SET_PLAN_TEXT, payload: text };
    }

    /// Set the editor modul
    public static setPlan(program: core.Plan): ActionVariant {
        return { type: ActionType.SET_PLAN, payload: program };
    }

    /// Set the editor program
    public static reducer(
        state: AppState = new AppState(),
        action: ActionVariant,
    ): AppState {
        switch (action.type) {
            case ActionType.CONFIGURE_APP:
                return {
                    ...state,
                    appSettings: action.payload,
                };
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
            case ActionType.SET_PLAN_TEXT:
                return {
                    ...state,
                    planText: action.payload
                };
            case ActionType.SET_PLAN:
                return {
                    ...state,
                    plan: action.payload
                };
            case ActionType.CLEAR_PLAN:
                return {
                    ...state,
                    plan: null
                };
            default:
                return state;
        }
    }
}
