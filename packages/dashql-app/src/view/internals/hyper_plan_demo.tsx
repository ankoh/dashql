import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './hyper_plan_demo.module.css';

import { useDashQLCoreSetup } from '../../core_provider.js';
import { PlanRenderer } from '../../view/plan/plan_renderer.js';

export function HyperPlanDemoPage(): React.ReactElement {
    const coreSetup = useDashQLCoreSetup();

    // Track wasm memory and destroy it using useEffect
    const viewModelRef = React.useRef<dashql.DashQLPlanViewModel | null>(null);
    React.useEffect(() => {
        return () => {
            viewModelRef.current?.destroy();
        }
    }, []);

    // Called when div is mounted
    const planRenderer = React.useRef<PlanRenderer | null>(null);
    const receiveDiv = React.useCallback((root: HTMLDivElement) => {
        if (planRenderer.current == null) {
            planRenderer.current = new PlanRenderer();
        }
        planRenderer.current.mountTo(root);
        console.log("mount");
    }, []);


    const [layoutConfig, _setLayoutConfig] = React.useState<dashql.DashQLPlanViewModelLayoutConfig>({
        hsep: 80.0,
        vsep: 40.0,
    });

    // Event handler that is called whenever the text changes
    const onChange = React.useCallback(async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const core = await coreSetup("hyper_plan_demo");
        if (viewModelRef.current == null) {
            viewModelRef.current = core.createPlanViewModel(layoutConfig);
        }

        // Parse the hyper plan
        let plan: dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel, dashql.buffers.view.PlanViewModelT> | null = null;
        try {
            const text = event.target.value;
            plan = viewModelRef.current.loadHyperPlan(text);
        } catch (e: any) {
            console.warn(e);
        }

        // Do we have a plan? Render it
        if (plan != null) {
            console.log("render");
            if (planRenderer.current == null) {
                planRenderer.current = new PlanRenderer();
            }
            planRenderer.current.render(plan);
        }
    }, []);

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
                <div className={styles.demo_section_body} ref={receiveDiv} />
            </div>
        </div>
    );
}
