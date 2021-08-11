// Copyright (c) 2021 The DashQL Authors

import React from 'react';
import * as Immutable from 'immutable';
import * as utils from '../utils';
import { Action, Dispatch, ProviderProps } from './model_context';
import { Program, InputValue } from './program';
import { ProgramInstance } from './program_instance';
import { Script, ScriptURIPrefix } from './script';

export type ProgramContext = {
    /// The file name
    readonly script: Script;
    /// The program
    readonly program: Program | null;
    /// The program input values
    readonly programInputValues: Immutable.List<InputValue>;
    /// The program instance
    readonly programInstance: ProgramInstance | null;
};

const initialState: ProgramContext = {
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

export type ProgramContextAction =
    | Action<typeof SET_SCRIPT, Script>
    | Action<typeof SET_PROGRAM, Program>
    | Action<typeof SET_PROGRAM_INSTANCE, ProgramInstance>
    | Action<typeof REWRITE_PROGRAM, ProgramInstance>;

const reducer = (ctx: ProgramContext, action: ProgramContextAction) => {
    console.log('PROGRAM CONTEXT REDUCER');
    console.log(action);
    switch (action.type) {
        case SET_SCRIPT:
            console.log('SET_SCRIPT');
            console.log(action.data);
            if (action.data.text == ctx.script.text) return ctx;
            return {
                ...ctx,
                script: action.data,
                program: null,
                programInstance: null,
            };
        case SET_PROGRAM:
            if (action.data == ctx.program) return ctx;
            return {
                ...ctx,
                program: action.data,
                programInstance: null,
            };

        case SET_PROGRAM_INSTANCE:
            if (action.data == ctx.programInstance) return ctx;
            return {
                ...ctx,
                programInstance: action.data,
            };

        case REWRITE_PROGRAM:
            return {
                ...ctx,
                script: {
                    ...ctx.script,
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

const programCtx = React.createContext<ProgramContext>(initialState);
const dispatchCtx = React.createContext<Dispatch<ProgramContextAction>>(() => {});

export const ProgramContextProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const [s, d] = React.useReducer(reducer, initialState);
    return (
        <programCtx.Provider value={s}>
            <dispatchCtx.Provider value={d}>{props.children}</dispatchCtx.Provider>
        </programCtx.Provider>
    );
};

export const useProgramContext = (): ProgramContext => React.useContext(programCtx);
export const useProgramContextDispatch = (): Dispatch<ProgramContextAction> => React.useContext(dispatchCtx);
