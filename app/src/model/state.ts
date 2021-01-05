import * as Immutable from "immutable";
import * as core from "@dashql/core";
import { LaunchStep, LaunchStepInfo, createLaunchSteps } from "./launch_step";
import { AppSettings } from "./settings";

export class AppState implements core.model.DerivedState {
    /// The launch is complete?
    public launchComplete: boolean = true;
    /// The launch progress
    public launchSteps: Immutable.Map<LaunchStep, LaunchStepInfo> = createLaunchSteps();
    /// The core
    public core: core.model.CoreState = new core.model.CoreState();
    // The app config
    public appSettings: AppSettings | null = null;
}
