import * as dashql from '@ankoh/dashql-core';
/// No index (u32::MAX)
const NO_INDEX = 0xFFFFFFFF;

type QueryProfileEvents = dashql.buffers.profile.QueryProfileEvents;
type ProfileStatsT = dashql.buffers.profile.ProfileStatsT;
const view = dashql.buffers.profile;

/// The effective state of an entity of a plan (a `ProfileUpdateEvent` of the core)
export interface ProfileEntityState {
    readonly status: dashql.buffers.profile.ProfileExecutionStatus;
    readonly stats: ProfileStatsT;
}

/// Is a statistics field known? A field that is not reported is unknown, not 0.
export function isStatReported(stats: ProfileStatsT, field: dashql.buffers.profile.ProfileStatsField): boolean {
    return (stats.reported & field) !== 0;
}

type States = ReadonlyArray<ProfileEntityState | undefined>;

/// The execution state of a plan: the effective state of every entity, folded from the output events of the core
/// query profile (`applyEvents`, `snapshotEvents`). Folding returns a new state, so React can compare states.
export class ProfileExecutionState {
    public static readonly EMPTY = new ProfileExecutionState(null, [], [], [], []);

    public constructor(
        public readonly query: ProfileEntityState | null,
        public readonly fragments: States,
        public readonly pipelines: States,
        public readonly slots: States,
        public readonly operators: States,
    ) {}

    /// Fold output events into a new state
    public withEvents(events: QueryProfileEvents): ProfileExecutionState {
        if (events.eventsLength() === 0) return this;
        let query = this.query;
        const fragments = [...this.fragments];
        const pipelines = [...this.pipelines];
        const slots = [...this.slots];
        const operators = [...this.operators];
        const event = new view.ProfileUpdateEvent();
        for (let i = 0; i < events.eventsLength(); ++i) {
            events.events(i, event);
            const state: ProfileEntityState = { status: event.status(), stats: event.stats()!.unpack() };
            switch (event.entity()) {
                case view.ProfileEntity.QUERY: query = state; break;
                case view.ProfileEntity.FRAGMENT: fragments[event.index()] = state; break;
                case view.ProfileEntity.PIPELINE: pipelines[event.index()] = state; break;
                case view.ProfileEntity.SLOT: slots[event.index()] = state; break;
                case view.ProfileEntity.OPERATOR: operators[event.index()] = state; break;
            }
        }
        return new ProfileExecutionState(query, fragments, pipelines, slots, operators);
    }

    /// The rows that flowed over an edge: the output of the slot of the child that carries the edge, or the output
    /// of the child operator if the slot reports none. Null if unknown.
    public edgeRows(slot: number, childOperator: number): bigint | null {
        const reported = (state: ProfileEntityState | undefined) =>
            state != null && isStatReported(state.stats, view.ProfileStatsField.TUPLES_OUT) ? state.stats.tuplesOut : null;
        return (slot !== NO_INDEX ? reported(this.slots[slot]) : null) ?? reported(this.operators[childOperator]);
    }
}
