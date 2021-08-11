// Copyright (c) 2021 The DashQL Authors

import React from 'react';
import { useAnalyzer } from './analyzer';
import {
    usePlanContext,
    useLogger,
    useProgramContext,
    SET_PROGRAM,
    SET_PROGRAM_INSTANCE,
    SCHEDULER_READY,
    useProgramContextDispatch,
    usePlanContextDispatch,
    TaskSchedulerStatus,
} from './model';
import { useDatabaseClient } from './database_client';
import { TaskExecutionContext } from './task/task_execution_context';
import { TaskGraphScheduler } from './task_scheduler';
import { useHTTPClient } from './http_client';
import { useJMESPathResolver } from './jmespath';

const MIN_INPUT_DELAY = 300;
const MAX_INPUT_DELAY = 1000;
const MIN_INSTANTIATION_DELAY = 100;

type Props = {
    children: React.ReactElement;
};

export const ScriptPipeline: React.FC<Props> = (props: Props) => {
    // Setup all hooks
    const logger = useLogger();
    const http = useHTTPClient();
    const jmespath = useJMESPathResolver();
    const database = useDatabaseClient();
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
        const program = analyzer.parseProgram(programContext.program.text);
        programParsedAt.current = new Date();
        programContextDispatch({
            type: SET_PROGRAM,
            data: program,
        });
    }, [programContext.script.text]);

    // Instantiate program if program or input values change
    React.useEffect(() => {
        const instanceTimeout = React.useRef<ReturnType<typeof setTimeout> | null>();
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
    const taskScheduler = React.useRef<TaskGraphScheduler>(new TaskGraphScheduler());
    React.useEffect(() => {
        // Scheduler not idle?
        if (planContext.schedulerStatus != TaskSchedulerStatus.Idle) return;
        // Same instance?
        if (planContext.plan.programInstance == programContext.programInstance) return;
        // Plan the program
        const plan = analyzer.planProgram();
        if (!plan) return;
        // Create the context
        const ctx: TaskExecutionContext = {
            logger,
            database,
            analyzer,
            http,
            jmespath,
            planContext,
            planContextDispatch,
            planContextDiff: [],
        };
        // Schedule the plan
        taskScheduler.current.prepare(ctx, plan);
        // Execute all tasks asynchronously
        (async () => {
            // Execute the plan
            await taskScheduler.current.execute(ctx);
            // No longer mounted?
            if (!isMountedRef.current) return;
            // Scheduler is ready again
            planContextDispatch({
                type: SCHEDULER_READY,
                data: null,
            });
        })();
    }, [planContext.schedulerStatus, programContext.programInstance]);

    return props.children;
};
