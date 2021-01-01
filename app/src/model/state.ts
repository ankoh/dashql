import * as core from "@dashql/core";
import { LaunchProgress } from "./launch_progress";
import { AppSettings } from "./settings";

export class AppState implements core.model.DerivedState {
    /// The core
    public core: core.model.CoreState;
    /// The launch progress
    public launchProgress: LaunchProgress;
    // The app config
    public appSettings: AppSettings | null;

    /// Constructor
    constructor() {
        this.core = new core.model.CoreState();
        this.launchProgress = new LaunchProgress();
        this.appSettings = null;
    }
}
