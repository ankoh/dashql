import * as React from 'react';
import * as flatbuffers from 'flatbuffers';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './hyper_plan_demo.module.css';

import { useDashQLCoreSetup } from '../../core_provider.js';
import { PlanRenderer } from '../../view/plan/plan_renderer.js';
import { Button } from '../../view/foundations/button.js';
import { HYPER_EXAMPLE_PLAN } from './hyper_plan_demo_example.js';
import { PlanTimelineRenderer } from '../../view/plan/timeline_renderer.js';

export function HyperPlanDemoPage(): React.ReactElement {
    const coreSetup = useDashQLCoreSetup();

    // Track wasm memory and destroy it using useEffect
    const viewModelRef = React.useRef<dashql.DashQLPlanViewModel | null>(null);
    React.useEffect(() => {
        return () => {
            viewModelRef.current?.destroy();
        }
    }, []);
    const [version, setVersion] = React.useState<number>(0);

    // Called when div is mounted
    const timelineRenderer = React.useRef<PlanTimelineRenderer | null>(null);
    const mountTimeline = React.useCallback((root: HTMLDivElement) => {
        if (planRenderer.current == null || timelineRenderer.current == null) {
            timelineRenderer.current = new PlanTimelineRenderer();
        }
        timelineRenderer.current.mountTo(root);
    }, []);
    const planRenderer = React.useRef<PlanRenderer | null>(null);
    const mountPlan = React.useCallback((root: HTMLDivElement) => {
        if (planRenderer.current == null || timelineRenderer.current == null) {
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
                if (planRenderer.current == null || timelineRenderer.current == null) {
                    planRenderer.current = new PlanRenderer();
                    timelineRenderer.current = new PlanTimelineRenderer();
                }
                timelineRenderer.current.render(plan);
                planRenderer.current.render(plan);
                plan.destroy();
            }
        };
        run();
    }, [planText]);


    // Plan updates
    React.useEffect(() => {
        const vm = viewModelRef.current;
        if (vm == null || vm.buffer == null || version == 0) {
            return;
        }
        const state = {
            nextPipelineId: 0,
            operatorStatus: new Uint8Array(vm.buffer.read().operatorsLength()),
        };

        const timeout: { current: any } = { current: null };
        const run = () => {
            if (planRenderer.current == null || viewModelRef.current == null) {
                return;
            }

            const eventTypes: dashql.buffers.view.PlanChangeEvent[] = [];
            const events: (dashql.buffers.view.UpdateOperatorEventT | dashql.buffers.view.UpdatePipelineEventT)[] = [];
            const pipelineCount = viewModelRef.current.buffer!.read().pipelinesLength();

            if (state.nextPipelineId == 0) {
                const plan = viewModelRef.current.resetExecution();
                planRenderer.current.render(plan);
                plan.destroy();
                state.operatorStatus = new Uint8Array(plan.read().operatorsLength());
            }

            if (state.nextPipelineId > 0 && (state.nextPipelineId % pipelineCount) == 0) {
                for (let i = 0; i < state.operatorStatus.length; ++i) {
                    if (state.operatorStatus[i] == dashql.buffers.view.PlanExecutionStatus.RUNNING) {
                        const event = new dashql.buffers.view.UpdateOperatorEventT();
                        event.operatorId = i;
                        event.executionStatus = dashql.buffers.view.PlanExecutionStatus.SUCCEEDED;
                        eventTypes.push(dashql.buffers.view.PlanChangeEvent.UpdateOperatorEvent);
                        events.push(event);
                    }
                }
                return;
            } else {
                const prevOperatorStatus = new Uint8Array(state.operatorStatus);
                if (state.nextPipelineId > 0) {
                    const prevPipelineId = state.nextPipelineId - 1;
                    const prevPipeline = viewModelRef.current.buffer!.read().pipelines(prevPipelineId)!;
                    for (let i = 0; i < prevPipeline.edgeCount(); ++i) {
                        const pipelineEdge = viewModelRef.current.buffer!.read().pipelineEdges(prevPipeline.edgesBegin() + i);
                        pipelineEdge!.childOperator();
                        state.operatorStatus[pipelineEdge!.childOperator()] = dashql.buffers.view.PlanExecutionStatus.SUCCEEDED;
                        state.operatorStatus[pipelineEdge!.parentOperator()] = dashql.buffers.view.PlanExecutionStatus.SUCCEEDED;
                    }
                }
                const nextPipeline = viewModelRef.current.buffer!.read().pipelines(state.nextPipelineId)!;
                for (let i = 0; i < nextPipeline.edgeCount(); ++i) {
                    const pipelineEdge = viewModelRef.current.buffer!.read().pipelineEdges(nextPipeline.edgesBegin() + i);
                    pipelineEdge!.childOperator();
                    state.operatorStatus[pipelineEdge!.childOperator()] = dashql.buffers.view.PlanExecutionStatus.RUNNING;
                    state.operatorStatus[pipelineEdge!.parentOperator()] = dashql.buffers.view.PlanExecutionStatus.RUNNING;
                }

                if (state.nextPipelineId > 0) {
                    const event = new dashql.buffers.view.UpdatePipelineEventT();
                    event.pipelineId = state.nextPipelineId - 1;
                    event.executionStatus = dashql.buffers.view.PlanExecutionStatus.SUCCEEDED;
                    event.executionStatistics = new dashql.buffers.view.PlanExecutionStatisticsT(
                        BigInt('0'),
                        BigInt('0'),
                        BigInt('0'),
                        BigInt('0'),
                        BigInt('0'),
                        BigInt('0')
                    );
                    eventTypes.push(dashql.buffers.view.PlanChangeEvent.UpdatePipelineEvent);
                    events.push(event);
                }

                // Emit the events
                for (let i = 0; i < Math.min(prevOperatorStatus.length, state.operatorStatus.length); ++i) {
                    let prevStatus = prevOperatorStatus[i];
                    let nextStatus = state.operatorStatus[i];
                    if (prevStatus != nextStatus) {
                        const event = new dashql.buffers.view.UpdateOperatorEventT();
                        event.operatorId = i;
                        event.executionStatus = nextStatus as dashql.buffers.view.PlanExecutionStatus;
                        event.executionStatistics = new dashql.buffers.view.PlanExecutionStatisticsT(
                            BigInt('0'),
                            BigInt('0'),
                            BigInt('0'),
                            BigInt('0'),
                            BigInt('0'),
                            BigInt('0')
                        );
                        eventTypes.push(dashql.buffers.view.PlanChangeEvent.UpdateOperatorEvent);
                        events.push(event);
                    }
                }
                {
                    const event = new dashql.buffers.view.UpdatePipelineEventT();
                    event.pipelineId = state.nextPipelineId;
                    event.executionStatus = dashql.buffers.view.PlanExecutionStatus.RUNNING;
                    eventTypes.push(dashql.buffers.view.PlanChangeEvent.UpdatePipelineEvent);
                    events.push(event);
                }
            }

            const builder = new flatbuffers.Builder(1024);
            const changeEvents = new dashql.buffers.view.PlanChangeEventsT(eventTypes, events);
            const changeEventsOfs = changeEvents.pack(builder);
            builder.finish(changeEventsOfs);
            const changeEventsBuf = builder.asUint8Array();
            const changeEventsBB = new flatbuffers.ByteBuffer(changeEventsBuf);
            const changeEventsPtr = dashql.buffers.view.PlanChangeEvents.getRootAsPlanChangeEvents(changeEventsBB);

            planRenderer.current.applyChangeEvents(changeEventsPtr);

            state.nextPipelineId += 1;
            setTimeout(run, 100 + Math.random() * 200);

        };
        timeout.current = setTimeout(run, 300);
        return () => clearTimeout(timeout.current);
    }, [version]);

    const executeQuery = React.useCallback(() => {
        setVersion(v => v + 1);
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
                        value={planText}
                    />
                    <div className={styles.demo_actions}>
                        <Button onClick={executeQuery}>
                            Execute Query
                        </Button>
                    </div>
                    <div className={styles.timeline_container} ref={mountTimeline} />
                    <div className={styles.plan_container} ref={mountPlan} />
                </div>
            </div>
        </div>
    );
}
