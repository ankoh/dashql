// Copyright (c) 2021 The DashQL Authors

import React from 'react';
import * as Immutable from 'immutable';
import * as utils from '../utils';
import { Action, Dispatch, ProviderProps } from './model_context';
import { Program, InputValue } from './program';
import { ProgramInstance } from './program_instance';
import { Script, ScriptOriginType } from './script';

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
        origin: {
            originType: ScriptOriginType.TMP,
            fileName: 'unnamed.dashql',
            exampleName: null,
            httpURL: null,
            githubAccount: null,
            githubGistName: null,
        },
        description: '',
        modified: false,
        lineCount: 0,
    },
    program: null,
    programInputValues: Immutable.List<InputValue>(),
    programInstance: null,
};

export const REPLACE_PROGRAM = Symbol('REPLACE_SCRIPT');
export const MODIFY_PROGRAM = Symbol('MODIFY_PROGRAM');
export const INSTANTIATE_PROGRAM = Symbol('INSTANTIATE_PROGRAM');
export const REWRITE_PROGRAM = Symbol('REWRITE_PROGRAM');

export interface ProgramTextChange {
    text: string;
    program: Program;
    lineCount: number;
    bytes: number;
}

export type ProgramContextAction =
    | Action<typeof REPLACE_PROGRAM, [Program, Script]>
    | Action<typeof MODIFY_PROGRAM, Program>
    | Action<typeof INSTANTIATE_PROGRAM, ProgramInstance>
    | Action<typeof REWRITE_PROGRAM, ProgramInstance>;

const reducer = (ctx: ProgramContext, action: ProgramContextAction) => {
    switch (action.type) {
        case REPLACE_PROGRAM: {
            const [program, script] = action.data;
            return {
                ...ctx,
                program,
                script,
            };
        }
        case MODIFY_PROGRAM: {
            const program = action.data;
            if (ctx.program == program) return ctx;
            return {
                ...ctx,
                script: {
                    ...ctx.script,
                    text: program.text,
                    lineCount: utils.countLines(program.text),
                    bytes: utils.estimateUTF16Length(program.text),
                    modified: true,
                },
                program,
            };
        }
        case INSTANTIATE_PROGRAM:
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

const programCtx = React.createContext<ProgramContext | null>(null);
const dispatchCtx = React.createContext<Dispatch<ProgramContextAction> | null>(null);

export const ProgramContextProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const [s, d] = React.useReducer(reducer, initialState);
    return (
        <programCtx.Provider value={s}>
            <dispatchCtx.Provider value={d}>{props.children}</dispatchCtx.Provider>
        </programCtx.Provider>
    );
};

export const useProgramContext = (): ProgramContext => React.useContext(programCtx)!;
export const useProgramContextDispatch = (): Dispatch<ProgramContextAction> => React.useContext(dispatchCtx)!;
