/// A launch progress status
export enum LaunchProgressStatus {
    PENDING = 0,
    STARTED = 1,
    COMPLETED = 2,
    FAILED = 3,
    WARNING = 4,
}

/// A launch progress
export class LaunchProgress {
    /// The app config
    public appConfig: LaunchProgressStatus = LaunchProgressStatus.COMPLETED;
    /// The version check
    public versionCheck: LaunchProgressStatus = LaunchProgressStatus.STARTED;
    /// The parser status
    public parserStatus: LaunchProgressStatus = LaunchProgressStatus.STARTED;
    /// The duckdb status
    public duckdbStatus: LaunchProgressStatus = LaunchProgressStatus.STARTED;
}

