import * as dashql from '@ankoh/dashql-core';
import * as flatbuffers from 'flatbuffers';
import { ProfileExecutionController } from './profile_execution_controller.js';
import { ProfileExecutionState } from '../../query/profile_execution_state.js';

const view = dashql.buffers.profile;
const { RUNNING, SUCCEEDED, UNKNOWN } = view.ProfileExecutionStatus;

/// Pack plan events
function planEvents(...events: InstanceType<typeof view.ProfileUpdateEventT>[]) {
    const builder = new flatbuffers.Builder();
    builder.finish(new view.QueryProfileEventsT(0, events).pack(builder));
    return view.QueryProfileEvents.getRootAsQueryProfileEvents(new flatbuffers.ByteBuffer(builder.asUint8Array()));
}
const update = (entity: number, index: number, status: number, tuplesOut: bigint | null = null) => new view.ProfileUpdateEventT(
    0n, entity, index, status,
    new view.ProfileStatsT(tuplesOut == null ? 0 : view.ProfileStatsField.TUPLES_OUT, 0n, 0n, 0n, tuplesOut ?? 0n),
);
const operatorUpdate = (id: number, status: number, tuplesOut: bigint | null = null) => update(view.ProfileEntity.OPERATOR, id, status, tuplesOut);
const pipelineUpdate = (id: number, status: number) => update(view.ProfileEntity.PIPELINE, id, status);
const svg = <K extends 'g' | 'path'>(tag: K) => document.createElementNS('http://www.w3.org/2000/svg', tag);

describe('ProfileExecutionController', () => {
    it('keeps mounted elements registered when execution state resets', () => {
        const controller = new ProfileExecutionController();
        const operator = svg('g');
        const pipeline = svg('path');

        controller.reset(1, 1);
        controller.registerOperator(0, operator);
        controller.registerPipeline(0, pipeline);
        operator.dataset.status = `${SUCCEEDED}`;
        pipeline.dataset.status = `${SUCCEEDED}`;

        controller.reset(1, 1);

        expect(operator.dataset.status).toEqual(`${UNKNOWN}`);
        expect(pipeline.dataset.status).toBeUndefined();
    });

    it('applies the operator and pipeline statuses of plan events', () => {
        const controller = new ProfileExecutionController();
        const operator = svg('g');
        const pipeline = svg('path');
        controller.reset(2, 1);
        controller.registerOperator(0, operator);
        controller.registerPipeline(0, pipeline);

        // Operators out of range and unregistered operators are skipped
        controller.applyEvents(planEvents(operatorUpdate(0, RUNNING), operatorUpdate(1, SUCCEEDED), operatorUpdate(5, RUNNING), pipelineUpdate(0, RUNNING)));
        expect(operator.dataset.status).toEqual(`${RUNNING}`);
        expect(pipeline.dataset.status).toEqual(`${RUNNING}`);

        // An operator registered later shows the status it already has
        const late = svg('g');
        controller.registerOperator(1, late);
        expect(late.dataset.status).toEqual(`${SUCCEEDED}`);
    });

    it('shows the statuses of an execution state', () => {
        const controller = new ProfileExecutionController();
        const operator = svg('g');
        controller.reset(1, 0);
        controller.registerOperator(0, operator);
        controller.applyState(ProfileExecutionState.EMPTY.withEvents(planEvents(operatorUpdate(0, SUCCEEDED))));
        expect(operator.dataset.status).toEqual(`${SUCCEEDED}`);
    });

    it('shows the status of the fragment for operators without status', () => {
        const controller = new ProfileExecutionController();
        const reported = svg('g');
        const inherited = svg('g');
        controller.reset(2, 0);
        controller.registerOperator(0, reported);
        controller.registerOperator(1, inherited);
        const state = ProfileExecutionState.EMPTY.withEvents(planEvents(
            operatorUpdate(0, SUCCEEDED),
            update(view.ProfileEntity.FRAGMENT, 0, RUNNING),
        ));
        controller.applyState(state, [0, 0]);
        expect(reported.dataset.status).toEqual(`${SUCCEEDED}`);
        expect(inherited.dataset.status).toEqual(`${RUNNING}`);
    });
});

describe('ProfileExecutionState', () => {
    it('folds events into a new state', () => {
        const state = ProfileExecutionState.EMPTY.withEvents(planEvents(operatorUpdate(0, RUNNING, 5n), operatorUpdate(1, RUNNING)));
        expect(ProfileExecutionState.EMPTY.operators).toHaveLength(0);
        expect(state.operators[0]?.status).toEqual(RUNNING);
        const next = state.withEvents(planEvents(operatorUpdate(0, SUCCEEDED, 7n)));
        expect(next).not.toBe(state);
        expect(next.operators[0]?.stats.tuplesOut).toEqual(7n);
        expect(state.withEvents(planEvents())).toBe(state);
    });

    it('takes the rows of an edge from the slot of the child, else from the child operator', () => {
        const state = ProfileExecutionState.EMPTY.withEvents(planEvents(
            update(view.ProfileEntity.SLOT, 0, RUNNING, 3n),
            operatorUpdate(0, RUNNING, 9n),
            operatorUpdate(1, RUNNING),
        ));
        expect(state.edgeRows(0, 0)).toEqual(3n);
        expect(state.edgeRows(0xFFFFFFFF, 0)).toEqual(9n);
        expect(state.edgeRows(1, 0)).toEqual(9n);
        // Not reported is unknown, not 0
        expect(state.edgeRows(0xFFFFFFFF, 1)).toBeNull();
    });
});
