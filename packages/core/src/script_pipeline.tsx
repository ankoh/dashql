import React from 'react';
import { useProgramState, useProgramStateDispatch, SET_PROGRAM, SET_PROGRAM_INSTANCE } from './model/program_store';
import { useAnalyzer } from './analyzer';
import { Platform } from './platform';
import { TaskContext } from './task';

const MIN_INPUT_DELAY = 300;
const MAX_INPUT_DELAY = 1000;
const MIN_INSTANTIATION_DELAY = 100;

type Props = {
    platform: Platform;
    children: React.ReactElement;
};

export const ScriptPipeline: React.FC<Props> = (props: Props) => {
    const analyzer = useAnalyzer();
    const state = useProgramState();
    const dispatch = useProgramStateDispatch();

    const isMountedRef = React.useRef(true);
    React.useEffect(() => {
        return () => void (isMountedRef.current = false);
    }, []);

    const programParsedAt = React.useRef<Date | null>(null);
    React.useEffect(() => {
        const program = analyzer.parseProgram(state.program.text);
        programParsedAt.current = new Date();
        dispatch({
            type: SET_PROGRAM,
            data: program,
        });
    }, [state.script.text]);

    React.useEffect(() => {
        const instanceTimeout = React.useRef<ReturnType<typeof setTimeout> | null>();
        const instantiateProgram = () => {
            if (!state.program || !isMountedRef.current) return;
            const nowMS = new Date().getTime();

            // Has a program been instantiated before?
            if (state.programInstance) {
                const lastInstantiation = state.programInstance.createdAt.getTime();
                const lastErrorCount = state.programInstance.program.buffer.errorsLength();

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
                if (state.program.buffer.errorsLength() > lastErrorCount) {
                    instanceTimeout.current = setTimeout(instantiateProgram, MAX_INPUT_DELAY - deltaMS);
                    return;
                }
            }
            instanceTimeout.current = null;
            // Instantiate the new program
            const instance = analyzer.instantiateProgram(state.programInputValues);
            // Instantiation failed?
            // XXX log error
            if (!instance) return;

            // Otherwise store the new instance in redux
            dispatch({
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
    }, [state.program, state.programInputValues]);

    React.useEffect(() => {
        const plan = analyzer.planProgram();
        if (!plan) return;

        // Schedule the plan
        const ctx = new TaskContext(platform, plan);
        scheduler.prepare(ctx);

        // Execute the plan
        await this._scheduler.execute(ctx);

        // Scheduler is ready again
        model.mutate(this._platform.store.dispatch, {
            type: model.StateMutationType.SCHEDULER_READY,
            data: null,
        });
    }, [state.programInstance]);

    return props.children;
};
