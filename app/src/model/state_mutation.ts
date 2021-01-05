import { model } from "@dashql/core";
import { AppState } from "./state";
import { AppConfig } from "./app_config";
import { LaunchStep, Status } from "./launch_step";

/// A mutation type
export enum StateMutationType {
    CONFIGURE_APP           = 'CONFIGURE_APP',
    UPDATE_LAUNCH_STEP      = 'UPDATE_LAUNCH_STEP',
    MARK_LAUNCH_COMPLETE     = 'SET_LAUNCH_COMPLETE',
    OTHER                   = 'OTHER',
}

/// An state mutation variant
export type StateMutationVariant =
    | model.StateMutation<StateMutationType.CONFIGURE_APP, AppConfig>
    | model.StateMutation<StateMutationType.UPDATE_LAUNCH_STEP, [LaunchStep, Status, string | null]>
    | model.StateMutation<StateMutationType.MARK_LAUNCH_COMPLETE, null>
    | model.StateMutationVariant
    ;

// The action dispatch
export type Dispatch = (mutation: StateMutationVariant) => void;
// Mutate the store
export function mutate(dispatch: Dispatch, m: StateMutationVariant) {
    return dispatch(m);
}
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
                    config: mutation.data,
                };
            case StateMutationType.UPDATE_LAUNCH_STEP: {
                const [step, status, error] = mutation.data;
                const steps = state.launchSteps.withMutations((s) => {
                    const info = s.get(step);
                    const now = new Date();
                    if (!info) return;
                    s.set(step, {
                        ...info,
                        startedAt: info.startedAt || now,
                        lastUpdateAt: now,
                        status: status,
                        error: error,
                    });
                });
                return {
                    ...state,
                    launchSteps: steps,
                };
            }
            case StateMutationType.MARK_LAUNCH_COMPLETE: {
                return {
                    ...state,
                    launchComplete: true,
                };
            }
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
