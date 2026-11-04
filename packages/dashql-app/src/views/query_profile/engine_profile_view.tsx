import * as React from 'react';

import * as dashql from '@ankoh/dashql-core';
import { useDashQLCoreSetup } from '../../runtime/core_provider.js';
import { ProfileExecutionState } from '../../query/profile_execution_state.js';
import { createProfileLayoutConfig, QueryProfileView } from './query_profile_view.js';
import { rotateProfileLayoutOrientation } from './profile_layout_config.js';

type ProfileEngine = dashql.buffers.profile.ProfileEngine;

export interface EngineProfileViewProps {
    engine: ProfileEngine;
    planText: string;
    className?: string;
    fallback?: React.ReactNode;
}

export interface QueryProfileState {
    /// The plan structure
    plan: dashql.FlatBufferPtr<dashql.buffers.profile.QueryProfile> | null;
    /// The execution state the plan carries (the rows of an analyzed plan)
    execution: ProfileExecutionState;
    /// The plan text is no plan of the engine
    rejected: boolean;
    /// Lay out the plan again with the other orientation, absent without plan
    rotate?: () => void;
}

/// Load the plan text of an engine into a core query profile
function loadPlan(viewModel: dashql.DashQLQueryProfile, engine: ProfileEngine, planText: string) {
    switch (engine) {
        case dashql.buffers.profile.ProfileEngine.HYPER:
            return viewModel.loadHyperPlan(planText);
        case dashql.buffers.profile.ProfileEngine.TRINO:
            return viewModel.loadTrinoPlan(planText);
        default:
            throw new Error(`Plans of engine ${engine} are not supported`);
    }
}

export function useQueryProfile(engine: ProfileEngine, planText: string | null): QueryProfileState {
    const coreSetup = useDashQLCoreSetup();
    const layoutConfig = React.useMemo(() => createProfileLayoutConfig(), []);
    const viewModelRef = React.useRef<dashql.DashQLQueryProfile | null>(null);
    const [state, setState] = React.useState<QueryProfileState>({ plan: null, execution: ProfileExecutionState.EMPTY, rejected: false });

    React.useEffect(() => {
        let cancelled = false;
        setState({ plan: null, execution: ProfileExecutionState.EMPTY, rejected: false });
        if (planText == null) return;
        const load = async () => {
            const core = await coreSetup('engine_profile_view');
            if (cancelled) return;
            viewModelRef.current ??= core.createQueryProfile(layoutConfig);
            try {
                const plan = loadPlan(viewModelRef.current, engine, planText);
                if (plan.read().operatorsLength() === 0) {
                    throw new Error('Plan contains no operators');
                }
                const execution = ProfileExecutionState.EMPTY.withEvents(viewModelRef.current.snapshotEvents().read());
                if (!cancelled) {
                    setState({ plan, execution, rejected: false });
                }
            } catch (error) {
                console.warn(error);
                if (!cancelled) {
                    setState({ plan: null, execution: ProfileExecutionState.EMPTY, rejected: true });
                }
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [coreSetup, layoutConfig, engine, planText]);

    React.useEffect(() => () => {
        viewModelRef.current?.destroy();
        viewModelRef.current = null;
    }, []);

    // The view model keeps the orientation, the next plans are laid out with it as well
    const rotate = React.useCallback(() => {
        const viewModel = viewModelRef.current;
        if (viewModel == null) return;
        const plan = viewModel.relayout(createProfileLayoutConfig(rotateProfileLayoutOrientation(viewModel.layout.orientation)));
        setState(current => current.plan == null ? current : { ...current, plan });
    }, []);

    return React.useMemo(() => state.plan == null ? state : { ...state, rotate }, [state, rotate]);
}

export function EngineProfileView(props: EngineProfileViewProps) {
    const { plan, execution, rejected, rotate } = useQueryProfile(props.engine, props.planText);

    if (rejected) return props.fallback ?? null;
    return <div className={props.className}>{plan != null && <QueryProfileView plan={plan} execution={execution} onRotate={rotate} />}</div>;
}
