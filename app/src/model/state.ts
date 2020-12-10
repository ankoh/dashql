import * as Immutable from "immutable";
import * as core from "@dashql/core";
import { TaskID, TaskInfo } from "./task";
import { LaunchProgress } from "./launch_progress";
import { AppSettings } from "./settings";

export class AppState {
    /// The core
    public core: core.model.State;
    /// The launch progress
    public launchProgress: LaunchProgress;
    // The app config
    public appSettings: AppSettings | null;
    // The tasks
    public tasks: Immutable.Map<number, TaskInfo>;

    /// Constructor
    constructor() {
        this.core = new core.model.State();
        this.launchProgress = new LaunchProgress();
        this.appSettings = null;
        this.tasks = Immutable.Map<TaskID, TaskInfo>();
    }
}

