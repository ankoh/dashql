import * as dashql from '@ankoh/dashql-core';
import { U32_MAX } from './numeric_limits.js';

type PlanEvents = dashql.buffers.view.PlanEvents;
type PlanStatsT = dashql.buffers.view.PlanStatsT;
const view = dashql.buffers.view;

/// The effective state of an entity of a plan (a `PlanUpdateEvent` of the core)
export interface PlanEntityState {
    readonly status: dashql.buffers.view.PlanExecutionStatus;
    readonly stats: PlanStatsT;
}

/// Is a statistics field known? A field that is not reported is unknown, not 0.
export function isStatReported(stats: PlanStatsT, field: dashql.buffers.view.PlanStatsField): boolean {
    return (stats.reported & field) !== 0;
}

type States = ReadonlyArray<PlanEntityState | undefined>;

/// The execution state of a plan: the effective state of every entity, folded from the output events of the core
/// plan view model (`applyEvents`, `snapshotEvents`). Folding returns a new state, so React can compare states.
export class PlanExecutionState {
    public static readonly EMPTY = new PlanExecutionState(null, [], [], [], []);

    public constructor(
        public readonly query: PlanEntityState | null,
        public readonly fragments: States,
        public readonly pipelines: States,
        public readonly slots: States,
        public readonly operators: States,
    ) {}

    /// Fold output events into a new state
    public withEvents(events: PlanEvents): PlanExecutionState {
        if (events.eventsLength() === 0) return this;
        let query = this.query;
        const fragments = [...this.fragments];
        const pipelines = [...this.pipelines];
        const slots = [...this.slots];
        const operators = [...this.operators];
        const event = new view.PlanUpdateEvent();
        for (let i = 0; i < events.eventsLength(); ++i) {
            events.events(i, event);
            const state: PlanEntityState = { status: event.status(), stats: event.stats()!.unpack() };
            switch (event.entity()) {
                case view.PlanEntity.QUERY: query = state; break;
                case view.PlanEntity.FRAGMENT: fragments[event.index()] = state; break;
                case view.PlanEntity.PIPELINE: pipelines[event.index()] = state; break;
                case view.PlanEntity.SLOT: slots[event.index()] = state; break;
                case view.PlanEntity.OPERATOR: operators[event.index()] = state; break;
            }
        }
        return new PlanExecutionState(query, fragments, pipelines, slots, operators);
    }

    /// The rows that flowed over an edge: the output of the slot of the child that carries the edge, or the output
    /// of the child operator if the slot reports none. Null if unknown.
    public edgeRows(slot: number, childOperator: number): bigint | null {
        const reported = (state: PlanEntityState | undefined) =>
            state != null && isStatReported(state.stats, view.PlanStatsField.TUPLES_OUT) ? state.stats.tuplesOut : null;
        return (slot !== U32_MAX ? reported(this.slots[slot]) : null) ?? reported(this.operators[childOperator]);
    }
}
