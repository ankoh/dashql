// Copyright (c) 2020 The DashQL Authors

import * as rd from '@duckdb/react-duckdb';
import React from 'react';
import { AnalyzerBindings } from './analyzer_bindings';
import { Analyzer } from './analyzer_browser';

import analyzer_wasm from './analyzer_wasm.wasm';

type Props = {
    children: React.ReactElement;
    value?: AnalyzerBindings;
};

const setupCtx = React.createContext<rd.Resolvable<AnalyzerBindings>>(null);
const resolverCtx = React.createContext<rd.Resolver<AnalyzerBindings>>(null);

export const AnalyzerProvider: React.FC<Props> = (props: Props) => {
    const [setup, updateSetup] = React.useState<rd.Resolvable<AnalyzerBindings>>(new rd.Resolvable());
    const inFlight = React.useRef<Promise<AnalyzerBindings | null> | null>(null);
    const resolver = React.useCallback(async () => {
        if (setup.value != null) return setup.value;
        if (setup.error != null) return null;
        const resolve = async () => {
            if (inFlight.current) return await inFlight.current;
            try {
                updateSetup(s => s.updateRunning());
                const ana = new Analyzer({}, analyzer_wasm);
                await ana.init();
                updateSetup(s => s.completeWith(ana));
                return ana;
            } catch (e: any) {
                inFlight.current = null;
                updateSetup(s => s.failWith(e));
                return null;
            }
        };
        inFlight.current = resolve();
        return await inFlight.current;
    }, []);
    return (
        <resolverCtx.Provider value={resolver}>
            <setupCtx.Provider value={setup}>{props.children}</setupCtx.Provider>;
        </resolverCtx.Provider>
    );
};

export const useAnalyzer = (): rd.Resolvable<AnalyzerBindings> => React.useContext(setupCtx)!;
export const useAnalyzerResolver = (): rd.Resolver<AnalyzerBindings> => React.useContext(resolverCtx)!;
