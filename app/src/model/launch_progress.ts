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
    public app_config: LaunchProgressStatus = LaunchProgressStatus.COMPLETED;
    /// The version check
    public version_check: LaunchProgressStatus = LaunchProgressStatus.STARTED;
    /// The parser status
    public parser_status: LaunchProgressStatus = LaunchProgressStatus.STARTED;
    /// The duckdb status
    public duckdb_status: LaunchProgressStatus = LaunchProgressStatus.STARTED;
}

