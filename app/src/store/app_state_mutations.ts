import * as parser from "@dashql/parser";
import { LogEntry } from "./log";
import { AppState } from "./app_state";
import { AppSettings } from "./app_settings";

const MAX_LOG_SIZE = 100;

/// An action
export class Action<T, P> {
    public readonly type: T;
    public readonly payload: P;
}

/// An action type
export enum ActionType {
    CONFIGURE_APP           = 'CONFIGURE_APP',
    LOG_PUSH_ENTRY          = 'LOG_PUSH_ENTRY',
    EDITOR_SET_PROGRAM      = 'EDITOR_SET_PROGRAM',
    EDITOR_SET_TEXT         = 'EDITOR_SET_TEXT',
    EDITOR_CLEAR_PROGRAM    = 'EDITOR_CLEAR_PROGRAM',
    OTHER                   = 'OTHER',
}

/// An action variant
export type ActionVariant =
    | Action<ActionType.CONFIGURE_APP, AppSettings>
    | Action<ActionType.LOG_PUSH_ENTRY, LogEntry>
    | Action<ActionType.EDITOR_SET_TEXT, string>
    | Action<ActionType.EDITOR_SET_PROGRAM, parser.FlatBuffer<parser.proto.program.Program>>
    | Action<ActionType.EDITOR_CLEAR_PROGRAM, {}>
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
    public static setEditorText(text: string): ActionVariant {
        return { type: ActionType.EDITOR_SET_TEXT, payload: text };
    }

    /// Set the editor program
    public static setEditorProgram(program: parser.FlatBuffer<parser.proto.program.Program>): ActionVariant {
        return { type: ActionType.EDITOR_SET_PROGRAM, payload: program };
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
            case ActionType.EDITOR_SET_PROGRAM:
                return {
                    ...state,
                    editorProgram: action.payload
                };
            case ActionType.EDITOR_CLEAR_PROGRAM:
                return {
                    ...state,
                    editorProgram: null 
                };
            default:
                return state;
        }
    }
}
