import * as dashql from '@akohn/dashql';
import type { ProfileExecutionState } from '@akohn/dashql/platform/query/profile_execution_state';

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

    /// Show the statuses of an execution state, after a reset. An operator without status of its own shows the
    /// status of its fragment (`operatorFragments`, by operator): Trino reports operators of finished stages only.
    public applyState(state: ProfileExecutionState, operatorFragments: readonly number[] = []) {
        for (let id = 0; id < this.statuses.length; ++id) {
            const own = state.operators[id]?.status ?? view.ProfileExecutionStatus.UNKNOWN;
            const fragment = operatorFragments[id];
            const inherited = fragment == null ? undefined : state.fragments[fragment]?.status;
            const status = own !== view.ProfileExecutionStatus.UNKNOWN ? own : inherited;
            if (status != null) this.setOperatorStatus(id, status);
        }
        state.pipelines.forEach((pipeline, id) => {
            if (pipeline != null) this.setPipelineStatus(id, pipeline.status);
        });
    }
}
