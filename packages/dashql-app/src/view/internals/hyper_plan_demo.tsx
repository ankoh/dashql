import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './hyper_plan_demo.module.css';

import { useDashQLCoreSetup } from '../../core_provider.js';
import { VariantKind } from 'utils/variant.js';

const HYPER_PLAN = Symbol('HYPER_PLAN');
const HYPER_PLAN_ERROR = Symbol('HYPER_PLAN_ERROR');

type HyperPlanState =
    | VariantKind<typeof HYPER_PLAN, dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>>
    | VariantKind<typeof HYPER_PLAN_ERROR, string>
    ;

export function HyperPlanDemoPage(): React.ReactElement {
    const coreSetup = useDashQLCoreSetup();

    // Track wasm memory refs and destroy them using useEffect
    const viewModelRef = React.useRef<dashql.DashQLPlanViewModel | null>(null);
    const planBufferRef = React.useRef<dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel> | null>(null);
    React.useEffect(() => {
        return () => {
            viewModelRef.current?.destroy();
            planBufferRef.current?.destroy();
        }
    }, []);

    const [layoutConfig, _setLayoutConfig] = React.useState<dashql.DashQLPlanViewModelLayoutConfig>({
        hsep: 8.0,
        vsep: 16.0,
    });
    const [planState, setPlanState] = React.useState<HyperPlanState | null>(null);

    const onChange = React.useCallback(async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const core = await coreSetup("hyper_plan_demo");
        if (viewModelRef.current == null) {
            viewModelRef.current = core.createPlanViewModel(layoutConfig);
        }
        const text = event.target.value;
        try {
            const plan = viewModelRef.current.loadHyperPlan(text);
            planBufferRef.current?.destroy();
            planBufferRef.current = plan;
            setPlanState({
                type: HYPER_PLAN,
                value: plan
            });
        } catch (e: any) {
            planBufferRef.current?.destroy();
            planBufferRef.current = null;
            setPlanState({
                type: HYPER_PLAN_ERROR,
                value: e.toString()
            });
        }
    }, []);

    const planStateDebug = React.useMemo<string | null>(() => {
        if (planState == null) {
            return null;
        }
        switch (planState.type) {
            case HYPER_PLAN:
                return JSON.stringify(planState.value.read().unpack(), (_, v) => typeof v === "bigint" ? v.toString() : v);
            case HYPER_PLAN_ERROR:
                return planState.value;
        }
    }, [planState]);

    return (
        <div className={styles.root}>
            <div className={styles.demo_section}>
                <div className={styles.demo_section_header}>
                    Hyper Plan Demo
                </div>
                <div className={styles.demo_section_body}>
                    <textarea
                        onChange={onChange}
                    />
                </div>
                <div className={styles.demo_section_body}>
                    {planStateDebug}
                </div>
            </div>
        </div>
    );
}
