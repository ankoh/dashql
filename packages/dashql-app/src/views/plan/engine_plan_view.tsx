import * as React from 'react';

import * as dashql from '@ankoh/dashql-core';
import { useDashQLCoreSetup } from '../../runtime/core_provider.js';
import { PlanExecutionState } from '../../query/plan_execution_state.js';
import { createPlanLayoutConfig, PlanView } from './plan_view.js';

type PlanEngine = dashql.buffers.view.PlanEngine;

export interface EnginePlanViewProps {
    engine: PlanEngine;
    planText: string;
    className?: string;
    fallback?: React.ReactNode;
}

export interface PlanViewModelState {
    /// The plan structure
    plan: dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel> | null;
    /// The execution state the plan carries (the rows of an analyzed plan)
    execution: PlanExecutionState;
    /// The plan text is no plan of the engine
    rejected: boolean;
}

/// Load the plan text of an engine into a core plan view model
function loadPlan(viewModel: dashql.DashQLPlanViewModel, engine: PlanEngine, planText: string) {
    switch (engine) {
        case dashql.buffers.view.PlanEngine.HYPER:
            return viewModel.loadHyperPlan(planText);
        default:
            throw new Error(`Plans of engine ${engine} are not supported`);
    }
}

export function usePlanViewModel(engine: PlanEngine, planText: string | null): PlanViewModelState {
    const coreSetup = useDashQLCoreSetup();
    const layoutConfig = React.useMemo(() => createPlanLayoutConfig(false), []);
    const viewModelRef = React.useRef<dashql.DashQLPlanViewModel | null>(null);
    const [state, setState] = React.useState<PlanViewModelState>({ plan: null, execution: PlanExecutionState.EMPTY, rejected: false });

    React.useEffect(() => {
        let cancelled = false;
        setState({ plan: null, execution: PlanExecutionState.EMPTY, rejected: false });
        if (planText == null) return;
        const load = async () => {
            const core = await coreSetup('engine_plan_view');
            if (cancelled) return;
            viewModelRef.current ??= core.createPlanViewModel(layoutConfig);
            try {
                const plan = loadPlan(viewModelRef.current, engine, planText);
                if (plan.read().operatorsLength() === 0) {
                    throw new Error('Plan contains no operators');
                }
                const execution = PlanExecutionState.EMPTY.withEvents(viewModelRef.current.snapshotEvents().read());
                if (!cancelled) {
                    setState({ plan, execution, rejected: false });
                }
            } catch (error) {
                console.warn(error);
                if (!cancelled) {
                    setState({ plan: null, execution: PlanExecutionState.EMPTY, rejected: true });
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

    return state;
}

export function EnginePlanView(props: EnginePlanViewProps) {
    const { plan, execution, rejected } = usePlanViewModel(props.engine, props.planText);

    if (rejected) return props.fallback ?? null;
    return <div className={props.className}>{plan != null && <PlanView plan={plan} execution={execution} />}</div>;
}
