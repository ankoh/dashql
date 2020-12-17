import * as core from  "@dashql/core";
import { LaunchProgress } from "./launch_progress";
import { AppSettings } from "./settings";
import { AppState } from "./state";
import { createTransform } from 'redux-persist';

export interface PersistentAppState {
    core: core.model.PersistentCoreState;
    launchProgress: LaunchProgress;
    appSettings: AppSettings | null;
};

function createPersistentStateTransform(platform: core.platform.Platform) {
    return createTransform(
        (inbound: PersistentAppState, _key): AppState => {
            return {
                ...inbound,
                core: core.model.rehydrateState(inbound.core, platform)
            };
        },
        (outbound: AppState, _key): PersistentAppState => {
            return {
                ...outbound,
                core: core.model.persistState(outbound.core, platform),
            };
        },
        {}
    );
}

export default createPersistentStateTransform;
