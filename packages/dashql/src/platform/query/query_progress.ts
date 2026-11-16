import * as dashql from '../../core/index.js';
import { ProfileExecutionState } from './profile_execution_state.js';
import type { QueryExecutionProgress } from './query_execution_state.js';

/// The progress model of a query runs in the query executor of the core (`dashql_core_runtime::query::progress`): the
/// executor applies the progress payloads of the engines and reports the structured progress with every progress
/// update, the query history of the core keeps the latest one. The app reads it from the view of the query.

/// The raw progress payload of an engine that a channel of the host reports, the progress model of the query in the
/// query executor of the core turns it into the structured progress
export type EngineProgressPayload =
    /// The status of a Hyper query (web HTTP API): the progress and the processed rows of the whole query
    { kind: 'hyper_query_status'; status: HyperQueryStatus; receivedAt: number };

/// The status of a Hyper query, the fields of the Hyper HTTP API that describe its progress
export interface HyperQueryStatus {
    completionStatus: string;
    rowCount: number | null;
    progress: number | null;
    executionStats: { wallClockTime: number; rowsProcessed: number } | null;
}

/// The query and the runtime that hold a progress, its recording and its followers read it there
export interface QueryProgressSource {
    readonly runtime: dashql.Runtime;
    readonly queryId: number;
}

/// The structured progress of a query: the profile structure (stages, the plan operators once the plan is known) and
/// its execution state, projected from the query history of the core
export interface QueryProfileProgress {
    /// The revision, it changes with the structure or the execution state
    readonly revision: number;
    /// The version of the structure
    readonly structureVersion: number;
    readonly structure: dashql.FlatBufferPtr<dashql.buffers.profile.QueryProfile>;
    readonly execution: ProfileExecutionState;
    /// The query that holds the progress, null for a replayed recording
    readonly source: QueryProgressSource | null;
}

/// The keys of a projected progress, the payloads of a view with these keys don't cross again
export function profileKeys(progress: QueryProfileProgress | null | undefined): dashql.QueryProfileKeys | null {
    return progress == null ? null : { revision: progress.revision, structureVersion: progress.structureVersion };
}

/// Project the structured progress of a view. The previous projection is the one whose keys the view was read with:
/// it stays while the revision doesn't move, and the payloads that the view leaves out are its ones.
export function projectProfileProgress(
    view: dashql.QueryProfileProgressView,
    previous: QueryProfileProgress | null,
    source: QueryProgressSource | null,
    readProfile: (bytes: Uint8Array) => dashql.FlatBufferPtr<dashql.buffers.profile.QueryProfile>,
): QueryProfileProgress | null {
    if (previous != null && previous.revision === view.revision && previous.structureVersion === view.structureVersion) {
        return previous;
    }
    const structure = view.structure != null
        ? readProfile(view.structure)
        : previous?.structureVersion === view.structureVersion ? previous.structure : null;
    if (structure == null) return null;
    const execution = view.execution != null
        ? ProfileExecutionState.EMPTY.withEvents(dashql.readFlatBuffer(view.execution, bb => dashql.buffers.profile.QueryProfileEvents.getRootAsQueryProfileEvents(bb)))
        : (previous?.execution ?? ProfileExecutionState.EMPTY);
    return { revision: view.revision, structureVersion: view.structureVersion, structure, execution, source };
}

/// The recording of the progress of a query as JSON: the payloads of the engine and when they arrived, replaying them
/// reproduces the progress. Null for a replayed progress and once the history is gone.
export function readProgressRecording(progress: QueryProfileProgress): string | null {
    if (progress.source == null) return null;
    try {
        return progress.source.runtime.queryProgressRecording(progress.source.queryId) ?? null;
    } catch {
        return null;
    }
}

/// The structures of the progress of queries by their bytes, a structure that didn't change keeps its bytes
const STRUCTURES = new WeakMap<Uint8Array, dashql.FlatBufferPtr<dashql.buffers.profile.QueryProfile>>();
/// The progress of queries by the view of their latest progress, a view that didn't change keeps its object
const PROGRESSES = new WeakMap<dashql.QueryLatestProgressView, QueryExecutionProgress>();

/// The progress of a query of a runtime with its structured progress, the same object while the view of the progress
/// doesn't change. The source names the query, its recording and its followers read it there.
export function queryProgress(core: dashql.DashQL, view: dashql.QueryLatestProgressView | null | undefined, source: QueryProgressSource | null): QueryExecutionProgress | null {
    if (view == null) return null;
    const cached = PROGRESSES.get(view);
    if (cached != null) return cached;
    const profile = view.profile;
    let profileProgress: QueryProfileProgress | null = null;
    if (profile?.structure != null) {
        const bytes = profile.structure;
        let structure = STRUCTURES.get(bytes);
        if (structure == null) {
            structure = core.readQueryProfile(bytes);
            STRUCTURES.set(bytes, structure);
        }
        const execution = profile.execution != null
            ? ProfileExecutionState.EMPTY.withEvents(dashql.readFlatBuffer(profile.execution, bb => dashql.buffers.profile.QueryProfileEvents.getRootAsQueryProfileEvents(bb)))
            : ProfileExecutionState.EMPTY;
        profileProgress = { revision: profile.revision, structureVersion: profile.structureVersion, structure, execution, source };
    }
    const progress: QueryExecutionProgress = {
        isQueued: view.isQueued,
        progressPercent: view.progressPercent,
        resultRows: view.resultRows,
        rowsProcessed: view.rowsProcessed,
        executionTimeMs: view.executionTimeMs,
        metrics: view.metrics,
        phase: view.phase,
        profileProgress,
    };
    PROGRESSES.set(view, progress);
    return progress;
}

/// Replay a recording of the progress of a query (JSON) up to a point in time in milliseconds since its first payload,
/// with a layout of the plan or the default one. Null if nothing happened until then.
export function replayProgressRecording(
    core: dashql.DashQL,
    recording: string,
    untilMs = Number.MAX_SAFE_INTEGER,
    layout: dashql.buffers.profile.ProfileLayoutConfigT | null = null,
): QueryProfileProgress | null {
    const view = core.replayQueryProgress(recording, untilMs, layout);
    return view == null ? null : projectProfileProgress(view, null, null, bytes => core.readQueryProfile(bytes));
}

/// Follows the progress of a query with a layout of its own, e.g. the other orientation of the plan. The progress
/// model of the query keeps its layout, the follower of the core replays the recorded payloads, the later ones as
/// they come.
export class QueryProgressFollower {
    private readonly native: dashql.DashQLQueryProgressFollower;
    private previous: QueryProfileProgress | null = null;

    public constructor(private readonly core: dashql.DashQL, layout: dashql.buffers.profile.ProfileLayoutConfigT) {
        this.native = core.createQueryProgressFollower(layout);
    }

    /// Follow the progress of a query, null before its first payload, for a replayed progress or once its history is
    /// gone
    public follow(progress: QueryProfileProgress): QueryProfileProgress | null {
        const source = progress.source;
        if (source == null) return null;
        // The progress of another query starts over
        const held = this.previous?.source;
        const previous = held != null && held.runtime === source.runtime && held.queryId === source.queryId ? this.previous : null;
        try {
            const view = this.native.follow(source.runtime, source.queryId, profileKeys(previous));
            this.previous = view == null ? null : projectProfileProgress(view, previous, source, bytes => this.core.readQueryProfile(bytes));
        } catch {
            this.previous = null;
        }
        return this.previous;
    }

    public destroy(): void {
        this.native.destroy();
        this.previous = null;
    }
}
