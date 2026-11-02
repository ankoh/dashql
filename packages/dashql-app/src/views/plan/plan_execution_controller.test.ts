import * as dashql from '@ankoh/dashql-core';
import * as flatbuffers from 'flatbuffers';
import { PlanExecutionController } from './plan_execution_controller.js';

const view = dashql.buffers.view;
const { RUNNING, SUCCEEDED } = view.PlanExecutionStatus;

/// Pack plan change events that update operators and pipelines
function changeEvents(...events: (InstanceType<typeof view.UpdateOperatorEventT> | InstanceType<typeof view.UpdatePipelineEventT>)[]) {
    const types = events.map(event => event instanceof view.UpdateOperatorEventT
        ? view.PlanChangeEvent.UpdateOperatorEvent
        : view.PlanChangeEvent.UpdatePipelineEvent);
    const builder = new flatbuffers.Builder();
    builder.finish(new view.PlanChangeEventsT(types, events).pack(builder));
    return view.PlanChangeEvents.getRootAsPlanChangeEvents(new flatbuffers.ByteBuffer(builder.asUint8Array()));
}
const operatorUpdate = (id: number, status: number) => new view.UpdateOperatorEventT(0n, id, status);
const pipelineUpdate = (id: number, status: number) => new view.UpdatePipelineEventT(0n, id, status);
const svg = <K extends 'g' | 'path'>(tag: K) => document.createElementNS('http://www.w3.org/2000/svg', tag);

describe('PlanExecutionController', () => {
    it('keeps mounted elements registered when execution state resets', () => {
        const controller = new PlanExecutionController();
        const operator = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const pipeline = document.createElementNS('http://www.w3.org/2000/svg', 'path');

        controller.reset(1, 1);
        controller.registerOperator(0, operator);
        controller.registerPipeline(0, pipeline);
        operator.dataset.status = `${dashql.buffers.view.PlanExecutionStatus.SUCCEEDED}`;
        pipeline.dataset.status = `${dashql.buffers.view.PlanExecutionStatus.SUCCEEDED}`;

        controller.reset(1, 1);

        expect(operator.dataset.status).toEqual(`${dashql.buffers.view.PlanExecutionStatus.UNKNOWN}`);
        expect(pipeline.dataset.status).toBeUndefined();
    });

    it('applies the operator and pipeline statuses of change events', () => {
        const controller = new PlanExecutionController();
        const operator = svg('g');
        const pipeline = svg('path');
        controller.reset(2, 1);
        controller.registerOperator(0, operator);
        controller.registerPipeline(0, pipeline);

        // Operators out of range and unregistered operators are skipped
        controller.applyChangeEvents(changeEvents(operatorUpdate(0, RUNNING), operatorUpdate(1, SUCCEEDED), operatorUpdate(5, RUNNING), pipelineUpdate(0, RUNNING)));
        expect(operator.dataset.status).toEqual(`${RUNNING}`);
        expect(pipeline.dataset.status).toEqual(`${RUNNING}`);

        // An operator registered later shows the status it already has
        const late = svg('g');
        controller.registerOperator(1, late);
        expect(late.dataset.status).toEqual(`${SUCCEEDED}`);
    });
});

