// Copyright (c) 2021 The DashQL Authors

import React from 'react';
import { useAnalyzer } from './analyzer';
import {
    usePlanContext,
    useProgramContext,
    SET_PROGRAM,
    SET_PROGRAM_INSTANCE,
    useProgramContextDispatch,
    usePlanContextDispatch,
    TaskSchedulerStatus,
    SCHEDULE_PLAN,
} from './model';
import { TaskSchedulerDriver } from './task_scheduler';

const MIN_INPUT_DELAY = 300;
const MAX_INPUT_DELAY = 1000;
const MIN_INSTANTIATION_DELAY = 100;

type Props = {
    children: React.ReactElement;
};

export const ScriptPipeline: React.FC<Props> = (props: Props) => {
    // Setup all hooks
    const analyzer = useAnalyzer();
    const programContext = useProgramContext();
    const programContextDispatch = useProgramContextDispatch();
    const planContext = usePlanContext();
    const planContextDispatch = usePlanContextDispatch();

    // Detect unmount
    const isMountedRef = React.useRef(true);
    React.useEffect(() => {
        return () => void (isMountedRef.current = false);
    }, []);

    // Parse program if script text changes
    const programParsedAt = React.useRef<Date | null>(null);
    React.useEffect(() => {
        const text = programContext.script?.text;
        if (!text) return;
        const program = analyzer.parseProgram(text);
        programParsedAt.current = new Date();
        programContextDispatch({
            type: SET_PROGRAM,
            data: program,
        });
    }, [programContext.script.text]);

    // Instantiate program if program or input values change
    const instanceTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(() => {
        const instantiateProgram = () => {
            if (!programContext.program || !isMountedRef.current) return;
            const nowMS = new Date().getTime();

            // Has a program been instantiated before?
            if (programContext.programInstance) {
                const lastInstantiation = programContext.programInstance.createdAt.getTime();
                const lastErrorCount = programContext.programInstance.program.buffer.errorsLength();

                // Wait at least MIN_INPUT_DELAY_MS after last input
                let deltaMS = nowMS - (programParsedAt.current?.getTime() || 0);
                if (deltaMS < MIN_INPUT_DELAY) {
                    instanceTimeout.current = setTimeout(instantiateProgram, MIN_INPUT_DELAY - deltaMS);
                    return;
                }
                // Wait at least MIN_DEBOUNCE_TIME after last instantiation
                deltaMS = nowMS - lastInstantiation;
                if (deltaMS < MIN_INSTANTIATION_DELAY) {
                    instanceTimeout.current = setTimeout(instantiateProgram, MIN_INSTANTIATION_DELAY - deltaMS);
                    return;
                }
                // Are there more errors than before?
                if (programContext.program.buffer.errorsLength() > lastErrorCount) {
                    instanceTimeout.current = setTimeout(instantiateProgram, MAX_INPUT_DELAY - deltaMS);
                    return;
                }
            }
            instanceTimeout.current = null;
            // Instantiate the new program
            const instance = analyzer.instantiateProgram(programContext.programInputValues);
            // Instantiation failed?
            // XXX log error
            if (!instance) return;

            // Otherwise store the new instance in redux
            programContextDispatch({
                type: SET_PROGRAM_INSTANCE,
                data: instance,
            });
        };
        instantiateProgram();
        return () => {
            if (instanceTimeout.current) {
                clearTimeout(instanceTimeout.current);
                instanceTimeout.current = null;
            }
        };
    }, [programContext.program, programContext.programInputValues]);

    // Schedule program if scheduler is idle and instance differs
    React.useEffect(() => {
        // Scheduler not idle?
        if (planContext.schedulerStatus != TaskSchedulerStatus.IDLE) return;
        // Same plan?
        if (planContext.plan?.programInstance == programContext.programInstance) return;
        // Plan the program
        const plan = analyzer.planProgram();
        if (!plan) return;
        // Schedule the plan
        planContextDispatch({
            type: SCHEDULE_PLAN,
            data: plan,
        });
    }, [planContext.schedulerStatus, programContext.programInstance]);

    return <TaskSchedulerDriver>{props.children}</TaskSchedulerDriver>;
};
