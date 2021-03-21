import * as Immutable from 'immutable';
import * as core from '@dashql/core';
import { LaunchStep, LaunchStepInfo, createLaunchSteps } from './launch_step';
import { AppConfig } from './app_config';

export class AppState implements core.model.DerivedState {
    /// The launch is complete?
    public launchComplete: boolean = false;
    /// The launch progress
    public launchSteps: Immutable.Map<LaunchStep, LaunchStepInfo> = createLaunchSteps();
    /// The app config
    public config: AppConfig | null = null;
    /// The core
    public core: core.model.CoreState = new core.model.CoreState();
}
