import * as Immutable from  "immutable";
import * as core from  "@dashql/core";
import { AppConfig } from "./app_config";
import { AppState } from "./state";
import { createTransform } from 'redux-persist';

export interface PersistentAppState {
    core: core.model.PersistentCoreState;
    config: AppConfig | null;
};

function createPersistentStateTransform(platform: core.platform.Platform) {
    return createTransform(
        (inbound: PersistentAppState, _key): AppState => {
            return {
                ...inbound,
                launchComplete: false,
                launchSteps: Immutable.Map(),
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
