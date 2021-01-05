import * as Immutable from "immutable";

/// Status code
export enum Status {
    NONE,
    RUNNING,
    BLOCKED,
    FAILED,
    COMPLETED,
}

/// A launch step
export enum LaunchStep {
    CONFIGURE_APP = 0,
    INIT_ANALYZER = 1,
    INIT_WEBDB = 2,
    LOAD_DEMO = 3,
}

/// A launch step info
export interface LaunchStepInfo {
    /// The label
    label: string;
    /// The status
    status: Status;
    /// The time when the step started
    startedAt: Date | null;
    /// The time when the step finished
    lastUpdateAt: Date | null;
    /// The error (if any)
    error: string | null;
}

export const DEFAULT_LAUNCH_STEPS = [
    LaunchStep.CONFIGURE_APP,
    LaunchStep.INIT_ANALYZER,
    LaunchStep.INIT_WEBDB,
    LaunchStep.LOAD_DEMO,
];

export function createLaunchSteps(): Immutable.Map<LaunchStep, LaunchStepInfo> {
    return Immutable.Map([
        [LaunchStep.CONFIGURE_APP, {
            label: "Configure the application",
            status: Status.NONE,
            startedAt: null,
            lastUpdateAt: null,
            error: null,
        }],
        [LaunchStep.INIT_ANALYZER, {
            label: "Initialize the analyzer",
            status: Status.NONE,
            startedAt: null,
            lastUpdateAt: null,
            error: null,
        }],
        [LaunchStep.INIT_WEBDB, {
            label: "Initialize the database",
            status: Status.NONE,
            startedAt: null,
            lastUpdateAt: null,
            error: null,
        }],
        [LaunchStep.LOAD_DEMO, {
            label: "Load the demo data",
            status: Status.NONE,
            startedAt: null,
            lastUpdateAt: null,
            error: null,
        }]
    ]);
}
