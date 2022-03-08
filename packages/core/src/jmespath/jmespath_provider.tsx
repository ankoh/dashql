// Copyright (c) 2020 The DashQL Authors

import React from 'react';
import { JMESPathBindings } from './jmespath_bindings';
import { JMESPath } from './jmespath_browser';
import { Status, LazyResolver, LazySetup } from '../model';

import jmespath_wasm from './jmespath_wasm.wasm';

type Props = {
    children: React.ReactElement;
    value?: JMESPathBindings;
};

const setupCtx = React.createContext<LazySetup<JMESPathBindings>>(null);
const resolverCtx = React.createContext<LazyResolver<JMESPathBindings>>(null);

export const JMESPathProvider: React.FC<Props> = (props: Props) => {
    const [setup, updateSetup] = React.useState<LazySetup<JMESPathBindings>>({
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
            const jp = new JMESPath(jmespath_wasm);
            await jp.init();
            updateSetup(s => ({
                ...s,
                value: jp,
                status: Status.COMPLETED,
                resolver: null,
            }));
            return jp;
        } catch (e) {
            updateSetup(s => ({
                ...s,
                value: null,
                status: Status.FAILED,
                error: e,
                resolver: null,
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

export const useJMESPath = (): LazySetup<JMESPathBindings> => React.useContext(setupCtx)!;
export const useJMESPathResolver = (): LazyResolver<JMESPathBindings> => React.useContext(resolverCtx)!;
