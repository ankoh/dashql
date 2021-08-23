// Copyright (c) 2021 The DashQL Authors

import React from 'react';
import { useAnalyzer } from './analyzer';
import {
    usePlanContext,
    useProgramContext,
    INSTANTIATE_PROGRAM,
    useProgramContextDispatch,
    usePlanContextDispatch,
    TaskSchedulerStatus,
    SCHEDULE_PLAN,
} from './model';
import { TaskSchedulerDriver } from './task_scheduler';

const MAX_INSTANTIATION_DELAY = 2000;
const MIN_INSTANTIATION_DELAY = 1000;

type Props = {
    children: React.ReactElement;
};

export const ProgramPipeline: React.FC<Props> = (props: Props) => {
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

    // Instantiate program if program or input values change
    const [instanceTimeout, setInstanceTimeout] = React.useState<{
        at: number;
        timer: ReturnType<typeof setTimeout> | null;
    }>({
        at: 0,
        timer: null,
    });
    React.useEffect(() => {
        // Not mounted or no program?
        if (!programContext.program || !isMountedRef.current) return;
        // Debounced?
        const nowMS = new Date().getTime();
        if (instanceTimeout.timer && nowMS < instanceTimeout.at) return;

        // Helper to clear the timer.
        // Clearing the timer will trigger a state transition and trigger the instantiation.
        const clearTimer = () => {
            if (!isMountedRef.current) return;
            setInstanceTimeout(s => ({ ...s, timer: null }));
        };
        // Helper to debounce the instantiation
        const debounce = (now: number, delta: number) => {
            if (instanceTimeout.timer) {
                clearTimeout(instanceTimeout.timer);
            }
            setInstanceTimeout({
                at: now + delta,
                timer: setTimeout(clearTimer, delta),
            });
        };

        // Has a program been instantiated before?
        if (programContext.programInstance) {
            const lastInstantiation = programContext.programInstance.createdAt.getTime();
            const lastErrorCount = programContext.programInstance.program.buffer.errorsLength();

            // Wait at least MIN_DEBOUNCE_TIME after last instantiation
            const deltaMS = nowMS - lastInstantiation;
            if (deltaMS < MIN_INSTANTIATION_DELAY) {
                debounce(nowMS, MIN_INSTANTIATION_DELAY - deltaMS);
                return;
            }
            // Are there more errors than before?
            if (programContext.program.buffer.errorsLength() > lastErrorCount) {
                debounce(nowMS, MAX_INSTANTIATION_DELAY - deltaMS);
                return;
            }
        }

        // Instantiate the new program
        const instance = analyzer.instantiateProgram(programContext.programInputValues);
        // Instantiation failed?
        // XXX log error
        if (instance == null) return;

        // Otherwise store the new instance in redux
        programContextDispatch({
            type: INSTANTIATE_PROGRAM,
            data: instance,
        });
    }, [programContext.program, programContext.programInputValues, instanceTimeout.timer]);

    // Schedule program if scheduler is idle and instance differs
    React.useEffect(() => {
        // Scheduler not idle?
        if (planContext.schedulerStatus != TaskSchedulerStatus.IDLE) return;
        // Same instance?
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
