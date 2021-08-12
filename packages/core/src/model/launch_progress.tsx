import React from 'react';
import * as Immutable from 'immutable';
import * as model from '../model';

/// Status code
export enum Status {
    NONE,
    RUNNING,
    BLOCKED,
    FAILED,
    COMPLETED,
}

/// A launch step
export enum LaunchStepType {
    CONFIGURE_APP = 0,
    INIT_ANALYZER = 1,
    INIT_DATABASE = 2,
}

/// A launch step info
export interface LaunchStep {
    /// The step type
    type: LaunchStepType;
    /// The label
    label: string;
    /// The status
    status: Status;
    /// The time when the step started
    startedAt: Date | null;
    /// The time when the step finished
    lastUpdateAt: Date | null;
    /// The error (if any)
    error: string | null;
}

export interface LaunchProgress {
    /// Is complete?
    complete: boolean;
    /// The steps
    steps: Immutable.Map<LaunchStepType, LaunchStep>;
}

export const LAUNCH_STEPS = [LaunchStepType.CONFIGURE_APP, LaunchStepType.INIT_ANALYZER, LaunchStepType.INIT_DATABASE];

export const initialLaunchProgress: LaunchProgress = {
    complete: false,
    steps: Immutable.Map([
        [
            LaunchStepType.CONFIGURE_APP,
            {
                type: LaunchStepType.CONFIGURE_APP,
                label: 'Configure the application',
                status: Status.NONE,
                startedAt: null,
                lastUpdateAt: null,
                error: null,
            },
        ],
        [
            LaunchStepType.INIT_ANALYZER,
            {
                type: LaunchStepType.INIT_ANALYZER,
                label: 'Initialize the analyzer',
                status: Status.NONE,
                startedAt: null,
                lastUpdateAt: null,
                error: null,
            },
        ],
        [
            LaunchStepType.INIT_DATABASE,
            {
                type: LaunchStepType.INIT_DATABASE,
                label: 'Initialize the database',
                status: Status.NONE,
                startedAt: null,
                lastUpdateAt: null,
                error: null,
            },
        ],
    ]),
};

export const UPDATE_LAUNCH_STEP = Symbol('UPDATE_LAUNCH_STEP');

export type LaunchProgressAction = model.Action<
    typeof UPDATE_LAUNCH_STEP,
    Partial<LaunchStep> & { type: LaunchStepType }
>;

export const reduceLaunchProgress = (ctx: LaunchProgress, action: LaunchProgressAction): LaunchProgress => {
    switch (action.type) {
        case UPDATE_LAUNCH_STEP: {
            const next = action.data;
            const steps = ctx.steps.withMutations(s => {
                const prev = s.get(next.type);
                const now = new Date();
                if (!prev) return;
                s.set(next.type, {
                    ...prev,
                    ...next,
                    startedAt: prev.startedAt,
                    lastUpdateAt: now,
                    status: next.status || prev.status,
                    error: next.error || prev.error,
                });
            });
            const complete = steps.reduce((accum, data) => accum && data.status == Status.COMPLETED, true);
            return {
                complete,
                steps,
            };
        }
    }
};

const stateCtx = React.createContext<LaunchProgress>(initialLaunchProgress);
const dispatchCtx = React.createContext<model.Dispatch<LaunchProgressAction>>(() => {});

export const LaunchProgressProvider: React.FC<model.ProviderProps> = (props: model.ProviderProps) => {
    const [s, d] = React.useReducer(reduceLaunchProgress, initialLaunchProgress);
    return (
        <stateCtx.Provider value={s}>
            <dispatchCtx.Provider value={d}>{props.children}</dispatchCtx.Provider>
        </stateCtx.Provider>
    );
};

export const useLaunchProgress = (): LaunchProgress => React.useContext(stateCtx);
export const useLaunchProgressDispatch = (): model.Dispatch<LaunchProgressAction> => React.useContext(dispatchCtx);
