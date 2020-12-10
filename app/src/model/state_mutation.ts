import { model, DashQLCoreBindings } from "@dashql/core";
import { LogEntry } from "./log";
import { AppState } from "./state";
import { AppSettings } from "./settings";

const MAX_LOG_SIZE = 100;

/// An action type
export enum ActionType {
    CONFIGURE_APP           = 'CONFIGURE_APP',
    LOG_PUSH_ENTRY          = 'LOG_PUSH_ENTRY',
    OTHER                   = 'OTHER',
}

/// An action variant
export type ActionVariant =
    | model.Action<ActionType.CONFIGURE_APP, AppSettings>
    | model.Action<ActionType.LOG_PUSH_ENTRY, LogEntry>
    | model.ActionVariant
    ;

/// Mutation of the application state
export class AppStateMutation {
    /// Configure the application
    public static configureApp(config: AppSettings): ActionVariant {
        return { type: ActionType.CONFIGURE_APP, payload: config };
    }

    /// Push a log entry
    public static pushLogEntry(log: LogEntry): ActionVariant {
        return { type: ActionType.LOG_PUSH_ENTRY, payload: log };
    }

    /// Set the editor program
    public static reduce(
        state: AppState = new AppState(),
        action: ActionVariant,
        core: DashQLCoreBindings,
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
            default: {
                return model.StateMutation.reduce(state, action, core);
            }
        }
    }
}
