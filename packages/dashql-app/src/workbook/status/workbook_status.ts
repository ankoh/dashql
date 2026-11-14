/// What a status of the workbook tells, the bar of the prompt colors its dot by it
export enum WorkbookStatusTone {
    /// Something runs: a query, Execute All, an upload, the agent
    Progress = 'progress',
    /// Something finished
    Success = 'success',
    /// Something failed
    Failed = 'failed',
    /// Something needs the user, e.g. a connection that is not connected
    Attention = 'attention',
}

/// Where a status of the workbook comes from
export enum WorkbookStatusSource {
    Agent = 'agent',
    ExecuteAll = 'execute_all',
    Query = 'query',
    Files = 'files',
    Cloud = 'cloud',
    Connection = 'connection',
}

/// A status of the workbook that Wobble tells on the bar of the prompt, and a line of its log
export interface WorkbookStatus {
    /// Unique among the statuses and the lines of the log
    key: string;
    source: WorkbookStatusSource;
    tone: WorkbookStatusTone;
    /// The status, short
    text: string;
    /// A muted detail after the text, e.g. the progress of a run
    detail?: string | null;
    /// The script the status is about, a click on the line of the log shows it
    scriptKey?: number | null;
    /// When it happened, in milliseconds since the epoch
    at: number;
    /// A line of the log that a live status left: what started, how it went on. The bar tells the newest line of the
    /// log that is not one, a live status that ended without a line of its own is over.
    progress?: boolean;
}

/// The name of a source in the log
export const WORKBOOK_STATUS_SOURCE_LABELS: Record<WorkbookStatusSource, string> = {
    [WorkbookStatusSource.Agent]: 'Agent',
    [WorkbookStatusSource.ExecuteAll]: 'Execute All',
    [WorkbookStatusSource.Query]: 'Query',
    [WorkbookStatusSource.Files]: 'Files',
    [WorkbookStatusSource.Cloud]: 'Cloud',
    [WorkbookStatusSource.Connection]: 'Connection',
};

/// The order of the sources when several things run at once, the first wins
const SOURCE_ORDER: WorkbookStatusSource[] = [
    WorkbookStatusSource.Agent,
    WorkbookStatusSource.ExecuteAll,
    WorkbookStatusSource.Query,
    WorkbookStatusSource.Files,
    WorkbookStatusSource.Cloud,
    WorkbookStatusSource.Connection,
];

function bySource(left: WorkbookStatus, right: WorkbookStatus): number {
    return SOURCE_ORDER.indexOf(left.source) - SOURCE_ORDER.indexOf(right.source);
}

/// The status that the bar shows. `live` are the conditions of the moment: what runs and what needs the user.
/// `log` are the things that happened, the newest last.
/// What runs comes first, then what needs the user, then the newest outcome in the log.
export function pickWorkbookStatus(live: readonly WorkbookStatus[], log: readonly WorkbookStatus[]): WorkbookStatus | null {
    const running = live.filter(status => status.tone === WorkbookStatusTone.Progress).sort(bySource);
    if (running.length > 0) return running[0];
    const attention = live.filter(status => status.tone !== WorkbookStatusTone.Progress).sort(bySource);
    if (attention.length > 0) return attention[0];
    for (let i = log.length - 1; i >= 0; --i) {
        if (!log[i].progress) return log[i];
    }
    return null;
}

/// Is anything running? Wobble's dot pulses then.
export function isWorkbookBusy(live: readonly WorkbookStatus[]): boolean {
    return live.some(status => status.tone === WorkbookStatusTone.Progress);
}
