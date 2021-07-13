import * as Immutable from 'immutable';
import * as core from '@dashql/core';
import { AppConfig } from './app_config';
import { AppState } from './state';
import { createTransform, Transform } from 'redux-persist';
import { LaunchStep, LaunchStepInfo } from './launch_step';

export interface PersistentAppState {
    core: core.model.PersistentCoreState;
    config: AppConfig | null;
}

function createPersistentStateTransform(platform: core.platform.Platform): Transform<PersistentAppState, AppState> {
    return createTransform(
        (inbound: PersistentAppState, _key): AppState => {
            return {
                ...inbound,
                launchComplete: false,
                launchSteps: Immutable.Map<LaunchStep, LaunchStepInfo>(),
                core: core.model.rehydrateState(inbound.core, platform),
            };
        },
        (outbound: AppState, _key): PersistentAppState => {
            return {
                ...outbound,
                core: core.model.persistState(outbound.core, platform),
            };
        },
        {},
    );
}

export default createPersistentStateTransform;
