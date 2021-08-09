import React, { createContext, useReducer } from 'react';
import * as Immutable from 'immutable';
import * as utils from '../utils';
import { Action, Dispatch, StoreProviderProps } from './store_context';
import { Program, InputValue } from './program';
import { ProgramInstance } from './program_instance';
import { Script, ScriptURIPrefix } from './script';

type State = {
    /// The file name
    readonly script: Script;
    /// The program
    readonly program: Program | null;
    /// The program input values
    readonly programInputValues: Immutable.List<InputValue>;
    /// The program instance
    readonly programInstance: ProgramInstance | null;
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
    programInstance: null,
};

export const SET_SCRIPT = Symbol('SET_SCRIPT');
export const SET_PROGRAM = Symbol('SET_PROGRAM');
export const SET_PROGRAM_INSTANCE = Symbol('SET_PROGRAM_INSTANCE');
export const REWRITE_PROGRAM = Symbol('REWRITE_PROGRAM');

type ActionVariant =
    | Action<typeof SET_SCRIPT, Script>
    | Action<typeof SET_PROGRAM, Program>
    | Action<typeof SET_PROGRAM_INSTANCE, ProgramInstance>
    | Action<typeof REWRITE_PROGRAM, ProgramInstance>;

const reducer = (state: State, action: ActionVariant) => {
    switch (action.type) {
        case SET_SCRIPT:
            if (action.data.text == state.script.text) return state;
            return {
                ...state,
                script: action.data,
                program: null,
                programInstance: null,
            };
        case SET_PROGRAM:
            if (action.data == state.program) return state;
            return {
                ...state,
                program: action.data,
                programInstance: null,
            };

        case SET_PROGRAM_INSTANCE:
            if (action.data == state.programInstance) return state;
            return {
                ...state,
                programInstance: action.data,
            };

        case REWRITE_PROGRAM:
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

export const useProgramState = (): State => React.useContext(stateCtx);
export const useProgramStateDispatch = (): Dispatch<ActionVariant> => React.useContext(dispatchCtx);
