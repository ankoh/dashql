// Copyright (c) 2020 The DashQL Authors

import React from 'react';
import { AnalyzerBindings } from './analyzer_bindings';
import { Analyzer } from './analyzer_browser';
import { Status, LazyResolver, LazySetup } from '../model';

import analyzer_wasm from './analyzer_wasm.wasm';

type Props = {
    children: React.ReactElement;
    value?: AnalyzerBindings;
};

const setupCtx = React.createContext<LazySetup<AnalyzerBindings>>(null);
const resolverCtx = React.createContext<LazyResolver<AnalyzerBindings>>(null);

export const AnalyzerProvider: React.FC<Props> = (props: Props) => {
    const [setup, updateSetup] = React.useState<LazySetup<AnalyzerBindings>>({
        status: props.value != null ? Status.COMPLETED : Status.NONE,
        value: props.value || null,
        error: null,
    });
    const resolver = React.useCallback(async () => {
        if (setup.value != null) return setup.value;
        if (setup.error != null) return null;
        try {
            updateSetup(s => ({
                ...s,
                status: Status.RUNNING,
            }));
            const jp = new Analyzer({}, analyzer_wasm);
            await jp.init();
            updateSetup(s => ({
                ...s,
                value: jp,
                status: Status.COMPLETED,
            }));
            return jp;
        } catch (e) {
            updateSetup(s => ({
                ...s,
                value: null,
                status: Status.FAILED,
                error: e,
            }));
        }
        return null;
    }, []);
    return (
        <resolverCtx.Provider value={resolver}>
            <setupCtx.Provider value={setup}>{props.children}</setupCtx.Provider>;
        </resolverCtx.Provider>
    );
};

export const useAnalyzer = (): LazySetup<AnalyzerBindings> => React.useContext(setupCtx)!;
export const useAnalyzerResolver = (): LazyResolver<AnalyzerBindings> => React.useContext(resolverCtx)!;
