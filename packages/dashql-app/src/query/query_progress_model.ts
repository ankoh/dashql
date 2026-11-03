import * as dashql from '@ankoh/dashql-core';
import { PlanExecutionState } from './plan_execution_state.js';

/// A raw progress payload of an engine, the progress model of the query turns it into events
export type EngineProgressPayload =
    /// The `stats` of a Trino `/v1/statement` response
    | { kind: 'trino_statement_stats'; stats: object; receivedAt: number };

/// The structured progress of a query: the plan structure (stages, later the plan) and its execution state
export interface QueryPlanProgress {
    structure: dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>;
    execution: PlanExecutionState;
}

/// The engine of a payload
function engineOf(payload: EngineProgressPayload): dashql.buffers.view.PlanEngine {
    switch (payload.kind) {
        case 'trino_statement_stats':
            return dashql.buffers.view.PlanEngine.TRINO;
    }
}

/// The progress model of one query: a core plan view model that the payloads of the engine are applied to.
/// The model lives in the query executor; the query state only holds the immutable `QueryPlanProgress`.
export class QueryProgressModel {
    private viewModel: dashql.DashQLPlanViewModel;
    private engine: dashql.buffers.view.PlanEngine;
    private progress: QueryPlanProgress;

    public constructor(core: dashql.DashQL, engine: dashql.buffers.view.PlanEngine, layout = new dashql.buffers.view.PlanLayoutConfigT()) {
        this.viewModel = core.createPlanViewModel(layout);
        this.engine = engine;
        this.progress = { structure: this.viewModel.startQuery(engine), execution: PlanExecutionState.EMPTY };
    }

    /// Apply a payload of the engine, a payload of another engine changes nothing
    public apply(payload: EngineProgressPayload): QueryPlanProgress {
        if (engineOf(payload) !== this.engine) return this.progress;
        let events: dashql.FlatBufferPtr<dashql.buffers.view.PlanEvents>;
        switch (payload.kind) {
            case 'trino_statement_stats':
                events = this.viewModel.applyTrinoStatementStats(JSON.stringify(payload.stats), payload.receivedAt);
                break;
        }
        const execution = this.progress.execution.withEvents(events.read());
        const structure = this.viewModel.buffer ?? this.progress.structure;
        if (execution !== this.progress.execution || structure !== this.progress.structure) {
            this.progress = { structure, execution };
        }
        return this.progress;
    }

    public destroy() {
        this.viewModel.destroy();
    }
}

/// The progress models of running queries, created with the first payload of a query
export class QueryProgressModels {
    private models = new Map<number, QueryProgressModel>();

    /// Apply a payload to the model of a query. Without core (still loading) the payload is dropped, the counters
    /// are cumulative, so the next payload catches up.
    public apply(core: dashql.DashQL | null, queryId: number, payload: EngineProgressPayload): QueryPlanProgress | null {
        let model = this.models.get(queryId);
        if (model == null) {
            if (core == null) return null;
            model = new QueryProgressModel(core, engineOf(payload));
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
