import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './hyper_plan_demo.module.css';

import { useDashQLCoreSetup } from '../../core_provider.js';
import { PlanRenderer } from '../../view/plan/plan_renderer.js';
import { HYPER_EXAMPLE_PLAN } from './hyper_plan_demo_example.js';

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
    }, []);

    const [layoutConfig, _setLayoutConfig] = React.useState<dashql.buffers.view.PlanLayoutConfigT>(() => {
        const config = new dashql.buffers.view.PlanLayoutConfigT();
        config.levelHeight = 64.0;
        config.nodeHeight = 32.0;
        config.nodeMarginHorizontal = 20.0;
        config.nodePaddingLeft = 8.0;
        config.nodePaddingRight = 8.0;
        config.iconWidth = 14.0;
        config.iconMarginRight = 8.0;
        config.maxLabelChars = 20;
        config.widthPerLabelChar = 8.5;
        config.nodeMinWidth = 0;
        return config;
    });

    const [planText, setPlanText] = React.useState<string>(HYPER_EXAMPLE_PLAN);

    // Event handler that is called whenever the text changes
    const onChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setPlanText(event.target.value);
    }, [setPlanText]);
    React.useEffect(() => {
        const run = async () => {
            const core = await coreSetup("hyper_plan_demo");
            if (viewModelRef.current == null) {
                viewModelRef.current = core.createPlanViewModel(layoutConfig);
            }

            // Parse the hyper plan
            let plan: dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel, dashql.buffers.view.PlanViewModelT> | null = null;
            try {
                plan = viewModelRef.current.loadHyperPlan(planText);
            } catch (e: any) {
                console.warn(e);
            }

            // Do we have a plan? Render it
            if (plan != null) {
                if (planRenderer.current == null) {
                    planRenderer.current = new PlanRenderer();
                }
                planRenderer.current.render(plan);
            }
        };
        run();
    }, [planText]);

    return (
        <div className={styles.root}>
            <div className={styles.demo_section}>
                <div className={styles.demo_section_header}>
                    Hyper Plan Demo
                </div>
                <div className={styles.demo_section_body}>
                    <textarea
                        onChange={onChange}
                        value={planText}
                    />
                </div>
                <div className={styles.demo_section_body} ref={receiveDiv} />
            </div>
        </div>
    );
}
