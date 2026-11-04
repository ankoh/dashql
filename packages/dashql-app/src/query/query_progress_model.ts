import * as dashql from '@ankoh/dashql-core';
import { ProfileExecutionState } from './profile_execution_state.js';

/// A raw progress payload of an engine, the progress model of the query turns it into events
export type EngineProgressPayload =
    /// The `stats` of a Trino `/v1/statement` response
    | { kind: 'trino_statement_stats'; stats: object; receivedAt: number }
    /// The QueryInfo of a Trino query (`/v1/query/{id}`) with the plans of its stages
    | { kind: 'trino_query_info'; info: object; receivedAt: number }
    /// A later QueryInfo of a Trino query: the operator summaries of the stages whose tasks are done
    | { kind: 'trino_query_info_stats'; info: object; receivedAt: number }
    /// The status of a Hyper query (web HTTP API): the progress and the processed rows of the whole query
    | { kind: 'hyper_query_status'; status: HyperQueryStatus; receivedAt: number };

/// The status of a Hyper query, the fields of the Hyper HTTP API that describe its progress
export interface HyperQueryStatus {
    completionStatus: string;
    rowCount: number | null;
    progress: number | null;
    executionStats: { wallClockTime: number; rowsProcessed: number } | null;
}

/// The work units of a progress fraction, Hyper reports a fraction instead of work units
const HYPER_PROGRESS_UNITS = 1000;

/// The input events of the status of a Hyper query: the query only, Hyper reports no stages or pipelines yet
function hyperQueryEvents(status: HyperQueryStatus, time: number): object[] {
    const stats: Record<string, number> = {};
    if (status.executionStats != null) {
        stats.tuplesIn = Math.max(0, Math.round(status.executionStats.rowsProcessed));
        stats.wallTimeUs = Math.max(0, Math.round(status.executionStats.wallClockTime * 1000));
    }
    if (status.rowCount != null) stats.tuplesOut = Math.max(0, Math.round(status.rowCount));
    if (status.progress != null) {
        // A fraction, values above 1 are percentages
        const fraction = Math.min(1, Math.max(0, status.progress > 1 ? status.progress / 100 : status.progress));
        stats.workDone = Math.round(fraction * HYPER_PROGRESS_UNITS);
        stats.workTotal = HYPER_PROGRESS_UNITS;
    }
    const finished = status.completionStatus === 'FINISHED';
    return [{ type: 'updateQuery', time: Math.max(0, Math.round(time)), status: finished ? 'succeeded' : 'running', stats }];
}

/// The structured progress of a query: the profile structure (stages, the plan operators once the plan is known)
/// and its execution state
export interface QueryProfileProgress {
    structure: dashql.FlatBufferPtr<dashql.buffers.profile.QueryProfile>;
    execution: ProfileExecutionState;
    /// The recording of the payloads so far, replaying it reproduces the profile
    recording: () => ProfileRecording;
}

/// A recording of the progress of a query: the raw payloads of the engine and when they arrived. Replaying the
/// payloads through the adapters of the core reproduces the profile at any point in time.
export interface ProfileRecording {
    version: 1;
    payloads: RecordedPayload[];
}

/// A payload of a recording
export interface RecordedPayload {
    /// The milliseconds since the first payload
    elapsedMs: number;
    payload: EngineProgressPayload;
}

/// The duration of a recording in milliseconds
export function recordingDuration(recording: ProfileRecording): number {
    return recording.payloads.reduce((duration, p) => Math.max(duration, p.elapsedMs), 0);
}

/// Replay a recording up to a point in time, returns null if nothing happened until then
export function replayRecording(
    core: dashql.DashQL,
    recording: ProfileRecording,
    untilMs: number,
    layout?: dashql.buffers.profile.ProfileLayoutConfigT,
): QueryProfileProgress | null {
    const payloads = recording.payloads.filter(p => p.elapsedMs <= untilMs);
    if (payloads.length === 0) return null;
    const model = new QueryProgressModel(core, engineOf(payloads[0].payload), layout);
    try {
        let progress: QueryProfileProgress | null = null;
        for (const { payload } of payloads) {
            progress = model.apply(payload);
        }
        return progress;
    } finally {
        model.destroy();
    }
}

/// A progress model that follows the recording of the progress of a query with a layout of its own, e.g. the
/// other orientation of the plan. The progress model of the query keeps its layout, the follower applies the
/// recorded payloads again, the ones that are recorded later as they come.
export class QueryProgressFollower {
    private model: QueryProgressModel | null = null;
    private source: (() => ProfileRecording) | null = null;
    private applied = 0;
    private progress: QueryProfileProgress | null = null;

    public constructor(private core: dashql.DashQL, private layout: dashql.buffers.profile.ProfileLayoutConfigT) {}

    /// Follow the progress of a query, null before its first payload
    public follow(progress: QueryProfileProgress): QueryProfileProgress | null {
        const payloads = progress.recording().payloads;
        // The progress of another query or another replay starts over
        if (progress.recording !== this.source || payloads.length < this.applied) {
            this.reset();
            this.source = progress.recording;
        }
        if (payloads.length === 0) return null;
        this.model ??= new QueryProgressModel(this.core, engineOf(payloads[0].payload), this.layout);
        for (let i = this.applied; i < payloads.length; ++i) {
            try {
                this.progress = this.model.apply(payloads[i].payload);
            } catch (e) {
                // A malformed payload is skipped, like by the progress model of the query
                console.warn(e);
            }
        }
        this.applied = payloads.length;
        return this.progress;
    }

    private reset() {
        this.model?.destroy();
        this.model = null;
        this.applied = 0;
        this.progress = null;
    }

    public destroy() {
        this.reset();
        this.source = null;
    }
}

/// Read a recording: a profile recording of the app, or a recording of the Trino test harness
/// (snapshots/profiles/trino/recordings/, written by //packages/trino-testing:trino_recorder)
export function readProfileRecording(text: string): ProfileRecording {
    const document = JSON.parse(text);
    if (document?.version === 1 && Array.isArray(document.payloads)) return document as ProfileRecording;
    if (Array.isArray(document?.statementResponses)) return convertTrinoHarnessRecording(document);
    throw new Error('The file is no profile recording');
}

/// A recording of the Trino test harness
interface TrinoHarnessRecording {
    statementResponses: { elapsedMs: number; body: { stats?: { rootStage?: unknown } } }[];
    queryInfos: { elapsedMs: number; body: { stages?: { stages?: { stageStats?: object }[] } } }[];
}

/// Convert a recording of the Trino test harness. Its QueryInfos are the ones the app fetches when the tasks of
/// stages are done and when the query finished. The last one carries the plans, the app requests them when the
/// stages appear, so the plans move there, without the operator summaries that arrive with the later QueryInfos.
function convertTrinoHarnessRecording(recording: TrinoHarnessRecording): ProfileRecording {
    const payloads: RecordedPayload[] = [];
    for (const response of recording.statementResponses) {
        if (response.body.stats == null) continue;
        payloads.push({ elapsedMs: response.elapsedMs, payload: { kind: 'trino_statement_stats', stats: response.body.stats, receivedAt: response.elapsedMs } });
    }
    for (const sample of recording.queryInfos) {
        payloads.push({ elapsedMs: sample.elapsedMs, payload: { kind: 'trino_query_info_stats', info: sample.body, receivedAt: sample.elapsedMs } });
    }
    const final = recording.queryInfos[recording.queryInfos.length - 1]?.body;
    const stagesAt = recording.statementResponses.find(r => r.body.stats?.rootStage != null)?.elapsedMs;
    if (final != null && stagesAt != null) {
        const stages = (final.stages?.stages ?? []).map(stage => ({
            ...stage,
            stageStats: { ...stage.stageStats, operatorSummaries: [] },
        }));
        const plans = { ...final, stages: { ...final.stages, stages } };
        payloads.push({ elapsedMs: stagesAt, payload: { kind: 'trino_query_info', info: plans, receivedAt: stagesAt } });
    }
    payloads.sort((a, b) => a.elapsedMs - b.elapsedMs);
    return { version: 1, payloads };
}

/// The engine of a payload
function engineOf(payload: EngineProgressPayload): dashql.buffers.profile.ProfileEngine {
    switch (payload.kind) {
        case 'trino_statement_stats':
        case 'trino_query_info':
        case 'trino_query_info_stats':
            return dashql.buffers.profile.ProfileEngine.TRINO;
        case 'hyper_query_status':
            return dashql.buffers.profile.ProfileEngine.HYPER;
    }
}

/// The progress model of one query: a core query profile that the payloads of the engine are applied to.
/// The model lives in the query executor; the query state only holds the immutable `QueryProfileProgress`.
export class QueryProgressModel {
    private profile: dashql.DashQLQueryProfile;
    private engine: dashql.buffers.profile.ProfileEngine;
    private progress: QueryProfileProgress;
    /// The latest statement stats, applied again on top of a plan that arrives later
    private latestStats: Extract<EngineProgressPayload, { kind: 'trino_statement_stats' }> | null = null;
    /// The payloads so far, the recording of the query
    private payloads: RecordedPayload[] = [];
    private readonly recording = (): ProfileRecording => ({ version: 1, payloads: [...this.payloads] });

    public constructor(core: dashql.DashQL, engine: dashql.buffers.profile.ProfileEngine, layout = new dashql.buffers.profile.ProfileLayoutConfigT()) {
        this.profile = core.createQueryProfile(layout);
        this.engine = engine;
        this.progress = { structure: this.profile.startQuery(engine), execution: ProfileExecutionState.EMPTY, recording: this.recording };
    }

    /// Apply a payload of the engine, a payload of another engine changes nothing
    public apply(payload: EngineProgressPayload): QueryProfileProgress {
        if (engineOf(payload) !== this.engine) return this.progress;
        const first = this.payloads[0]?.payload.receivedAt ?? payload.receivedAt;
        this.payloads.push({ elapsedMs: Math.max(0, payload.receivedAt - first), payload });
        let execution: ProfileExecutionState;
        switch (payload.kind) {
            case 'trino_statement_stats': {
                this.latestStats = payload;
                const events = this.profile.applyTrinoStatementStats(JSON.stringify(payload.stats), payload.receivedAt);
                execution = this.progress.execution.withEvents(events.read());
                break;
            }
            case 'trino_query_info': {
                // The plan replaces the stages that the stats registered. The stats are cumulative, applying the
                // latest ones again restores the state on the stages of the plan.
                try {
                    this.profile.loadTrinoPlan(JSON.stringify(payload.info));
                } catch (e) {
                    // Without a plan the stages stay a list
                    console.warn(e);
                    this.profile.startQuery(this.engine);
                }
                if (this.latestStats != null) {
                    this.profile.applyTrinoStatementStats(JSON.stringify(this.latestStats.stats), this.latestStats.receivedAt);
                }
                // The operator summaries of the stages that finished already
                this.profile.applyTrinoQueryInfo(JSON.stringify(payload.info), payload.receivedAt);
                execution = ProfileExecutionState.EMPTY.withEvents(this.profile.snapshotEvents().read());
                break;
            }
            case 'hyper_query_status': {
                const events = this.profile.applyEvents(JSON.stringify(hyperQueryEvents(payload.status, payload.receivedAt)));
                execution = this.progress.execution.withEvents(events.read());
                break;
            }
            case 'trino_query_info_stats': {
                const events = this.profile.applyTrinoQueryInfo(JSON.stringify(payload.info), payload.receivedAt);
                execution = this.progress.execution.withEvents(events.read());
                break;
            }
        }
        const structure = this.profile.buffer ?? this.progress.structure;
        if (execution !== this.progress.execution || structure !== this.progress.structure) {
            this.progress = { structure, execution, recording: this.recording };
        }
        return this.progress;
    }

    public destroy() {
        this.profile.destroy();
    }
}

/// The progress models of running queries, created with the first payload of a query
export class QueryProgressModels {
    private models = new Map<number, QueryProgressModel>();

    /// The layout of the profiles of the queries
    public constructor(private layout = new dashql.buffers.profile.ProfileLayoutConfigT()) {}

    /// Apply a payload to the model of a query. Without core (still loading) the payload is dropped, the counters
    /// are cumulative, so the next payload catches up.
    public apply(core: dashql.DashQL | null, queryId: number, payload: EngineProgressPayload): QueryProfileProgress | null {
        let model = this.models.get(queryId);
        if (model == null) {
            if (core == null) return null;
            model = new QueryProgressModel(core, engineOf(payload), this.layout);
            this.models.set(queryId, model);
        }
        try {
            return model.apply(payload);
        } catch (e) {
            // A malformed payload must not interrupt the query
            console.warn(e);
            return null;
        }
    }

    /// Release the model of a query
    public release(queryId: number) {
        this.models.get(queryId)?.destroy();
        this.models.delete(queryId);
    }
}
