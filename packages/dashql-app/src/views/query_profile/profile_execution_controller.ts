import * as dashql from '@ankoh/dashql-core';
import type { ProfileExecutionState } from '../../query/profile_execution_state.js';

const view = dashql.buffers.profile;

/// Updates the status markers of a mounted plan in place, without rendering the plan again
export class ProfileExecutionController {
    private operatorElements: Array<SVGGElement | null> = [];
    private pipelinePaths: Array<SVGPathElement | null> = [];
    private statuses = new Uint8Array();

    public reset(operatorCount: number, pipelineCount: number) {
        this.operatorElements.length = operatorCount;
        this.pipelinePaths.length = pipelineCount;
        this.statuses = new Uint8Array(operatorCount);
        for (const element of this.operatorElements) {
            if (element != null) element.dataset.status = `${view.ProfileExecutionStatus.UNKNOWN}`;
        }
        for (const path of this.pipelinePaths) {
            if (path != null) delete path.dataset.status;
        }
    }

    public registerOperator(id: number, element: SVGGElement | null) {
        this.operatorElements[id] = element;
        if (element != null) element.dataset.status = `${this.statuses[id] ?? view.ProfileExecutionStatus.UNKNOWN}`;
    }

    public registerPipeline(id: number, path: SVGPathElement | null) {
        this.pipelinePaths[id] = path;
    }

    private setOperatorStatus(id: number, status: dashql.buffers.profile.ProfileExecutionStatus) {
        if (id >= this.statuses.length || this.statuses[id] === status) return;
        this.statuses[id] = status;
        const element = this.operatorElements[id];
        if (element != null) element.dataset.status = `${status}`;
    }

    private setPipelineStatus(id: number, status: dashql.buffers.profile.ProfileExecutionStatus) {
        const path = this.pipelinePaths[id];
        if (path != null) path.dataset.status = `${status}`;
    }

    /// Apply the output events of the core query profile
    public applyEvents(events: dashql.buffers.profile.QueryProfileEvents) {
        const event = new view.ProfileUpdateEvent();
        for (let i = 0; i < events.eventsLength(); ++i) {
            events.events(i, event);
            switch (event.entity()) {
                case view.ProfileEntity.OPERATOR:
                    this.setOperatorStatus(event.index(), event.status());
                    break;
                case view.ProfileEntity.PIPELINE:
                    this.setPipelineStatus(event.index(), event.status());
                    break;
            }
        }
    }

    /// Show the statuses of an execution state, after a reset
    public applyState(state: ProfileExecutionState) {
        state.operators.forEach((operator, id) => {
            if (operator != null) this.setOperatorStatus(id, operator.status);
        });
        state.pipelines.forEach((pipeline, id) => {
            if (pipeline != null) this.setPipelineStatus(id, pipeline.status);
        });
    }
}
