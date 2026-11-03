import * as dashql from '@ankoh/dashql-core';
import { ProfileExecutionState } from './profile_execution_state.js';

/// A raw progress payload of an engine, the progress model of the query turns it into events
export type EngineProgressPayload =
    /// The `stats` of a Trino `/v1/statement` response
    | { kind: 'trino_statement_stats'; stats: object; receivedAt: number }
    /// The QueryInfo of a Trino query (`/v1/query/{id}`) with the plans of its stages
    | { kind: 'trino_query_info'; info: object; receivedAt: number };

/// The structured progress of a query: the profile structure (stages, the plan operators once the plan is known)
/// and its execution state
export interface QueryProfileProgress {
    structure: dashql.FlatBufferPtr<dashql.buffers.profile.QueryProfile>;
    execution: ProfileExecutionState;
}

/// The engine of a payload
function engineOf(payload: EngineProgressPayload): dashql.buffers.profile.ProfileEngine {
    switch (payload.kind) {
        case 'trino_statement_stats':
        case 'trino_query_info':
            return dashql.buffers.profile.ProfileEngine.TRINO;
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

    public constructor(core: dashql.DashQL, engine: dashql.buffers.profile.ProfileEngine, layout = new dashql.buffers.profile.ProfileLayoutConfigT()) {
        this.profile = core.createQueryProfile(layout);
        this.engine = engine;
        this.progress = { structure: this.profile.startQuery(engine), execution: ProfileExecutionState.EMPTY };
    }

    /// Apply a payload of the engine, a payload of another engine changes nothing
    public apply(payload: EngineProgressPayload): QueryProfileProgress {
        if (engineOf(payload) !== this.engine) return this.progress;
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
                execution = ProfileExecutionState.EMPTY.withEvents(this.profile.snapshotEvents().read());
                break;
            }
        }
        const structure = this.profile.buffer ?? this.progress.structure;
        if (execution !== this.progress.execution || structure !== this.progress.structure) {
            this.progress = { structure, execution };
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
