import { model } from "@dashql/core";
import { AppState } from "./state";
import { AppSettings } from "./settings";

/// A mutation type
export enum StateMutationType {
    CONFIGURE_APP           = 'CONFIGURE_APP',
    OTHER                   = 'OTHER',
}

/// An state mutation variant
export type StateMutationVariant =
    | model.StateMutation<StateMutationType.CONFIGURE_APP, AppSettings>
    | model.StateMutationVariant
    ;

/// Mutation of the application state
export class AppStateMutation {
    /// Set the editor program
    public static reduce(
        state: AppState = new AppState(),
        mutation: StateMutationVariant,
    ): AppState {
        switch (mutation.type) {
            case StateMutationType.CONFIGURE_APP:
                return {
                    ...state,
                    appSettings: mutation.payload,
                };
            default: {
                const s = model.StateMutations.reduce(state.core, mutation);
                return s === state.core ? state : {
                    ...state,
                    core: s 
                };
            }
        }
    }
}
