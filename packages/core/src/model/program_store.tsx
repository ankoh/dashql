import React, { createContext, useReducer } from 'react';
import * as Immutable from 'immutable';
import * as utils from '../utils';
import { Action, Dispatch, StoreProviderProps } from './store_context';
import { Program, InputValue } from './program';
import { ProgramInstance } from './program_instance';
import { Script, ScriptURIPrefix } from './script';

type State = {
    /// The file name
    script: Script;
    /// The program
    program: Program | null;
    /// The program input values
    programInputValues: Immutable.List<InputValue>;
    /// The program dependencies
    programDependencies: Map<number, number[]>;
    /// The program instance
    programInstance: ProgramInstance | null;
};

const initialState: State = {
    script: {
        text: '',
        uriPrefix: ScriptURIPrefix.TMP,
        uriName: 'unnamed.dashql',
        modified: false,
        lineCount: 0,
    },
    program: null,
    programInputValues: Immutable.List<InputValue>(),
    programDependencies: new Map<number, number[]>(),
    programInstance: null,
};

enum ActionType {
    SET_SCRIPT = 'SET_SCRIPT',
    SET_PROGRAM = 'SET_PROGRAM',
    SET_PROGRAM_INSTANCE = 'SET_PROGRAM_INSTANCE',
    REWRITE_PROGRAM = 'REWRITE_PROGRAM_INSTANCE',
}

type ActionVariant =
    | Action<ActionType.SET_SCRIPT, Script>
    | Action<ActionType.SET_PROGRAM, Program>
    | Action<ActionType.SET_PROGRAM_INSTANCE, ProgramInstance>
    | Action<ActionType.REWRITE_PROGRAM, ProgramInstance>;

const reducer = (state: State, action: ActionVariant) => {
    switch (action.type) {
        case ActionType.SET_SCRIPT:
            if (action.data.text == state.script.text) return state;
            return {
                ...state,
                script: action.data,
                program: null,
                programInstance: null,
            };
        case ActionType.SET_PROGRAM:
            if (action.data == state.program) return state;
            return {
                ...state,
                program: action.data,
                programInstance: null,
            };

        case ActionType.SET_PROGRAM_INSTANCE:
            if (action.data == state.programInstance) return state;
            return {
                ...state,
                programInstance: action.data,
            };

        case ActionType.REWRITE_PROGRAM:
            return {
                ...state,
                script: {
                    ...state.script,
                    modified: true,
                    text: action.data.program.text,
                    lineCount: utils.countLines(action.data.program.text),
                    bytes: utils.estimateUTF16Length(action.data.program.text),
                },
                program: action.data.program,
                programInstance: action.data,
            };
    }
};

const stateCtx = createContext<State>(initialState);
const dispatchCtx = createContext<Dispatch<ActionVariant>>(() => {});

export const ProgramStoreProvider: React.FC<StoreProviderProps> = (props: StoreProviderProps) => {
    const [s, d] = useReducer(reducer, initialState);
    return (
        <stateCtx.Provider value={s}>
            <dispatchCtx.Provider value={d}>{props.children}</dispatchCtx.Provider>
        </stateCtx.Provider>
    );
};

export const useProgram = (): State => React.useContext(stateCtx);
export const useProgramDispatch = (): Dispatch<ActionVariant> => React.useContext(dispatchCtx);
