import { model, DashQLCoreWasmBindings } from "@dashql/core";
import { AppState } from "./state";
import { AppSettings } from "./settings";

/// An action type
export enum ActionType {
    CONFIGURE_APP           = 'CONFIGURE_APP',
    OTHER                   = 'OTHER',
}

/// An action variant
export type ActionVariant =
    | model.Action<ActionType.CONFIGURE_APP, AppSettings>
    | model.ActionVariant
    ;

/// Mutation of the application state
export class AppStateMutation {
    /// Configure the application
    public static configureApp(config: AppSettings): ActionVariant {
        return { type: ActionType.CONFIGURE_APP, payload: config };
    }

    /// Set the editor program
    public static reduce(
        state: AppState = new AppState(),
        action: ActionVariant,
        core: DashQLCoreWasmBindings,
    ): AppState {
        switch (action.type) {
            case ActionType.CONFIGURE_APP:
                return {
                    ...state,
                    appSettings: action.payload,
                };
            default: {
                const s = model.StateMutation.reduce(state.core, action, core);
                return s === state.core ? state : {
                    ...state,
                    core: s 
                };
            }
        }
    }
}
