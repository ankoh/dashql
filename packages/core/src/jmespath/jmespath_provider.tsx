// Copyright (c) 2020 The DashQL Authors

import * as rd from '@duckdb/react-duckdb';
import React from 'react';
import { JMESPathBindings } from './jmespath_bindings';
import { JMESPath } from './jmespath_browser';

import jmespath_wasm from './jmespath_wasm.wasm';

type Props = {
    children: React.ReactElement;
    value?: JMESPathBindings;
};

const setupCtx = React.createContext<rd.Resolvable<JMESPathBindings>>(null);
const resolverCtx = React.createContext<rd.Resolver<JMESPathBindings>>(null);

export const JMESPathProvider: React.FC<Props> = (props: Props) => {
    const [setup, updateSetup] = React.useState<rd.Resolvable<JMESPathBindings>>(new rd.Resolvable());
    const lock = React.useRef<boolean>(false);
    const resolver = React.useCallback(async () => {
        if (setup.value != null) return setup.value;
        if (setup.error != null) return null;
        if (lock.current) return null;
        lock.current = true;
        try {
            updateSetup(s => s.updateRunning());
            const jp = new JMESPath(jmespath_wasm);
            await jp.init();
            updateSetup(s => s.completeWith(jp));
            return jp;
        } catch (e: any) {
            lock.current = false;
            updateSetup(s => s.failWith(e));
        }
        return null;
    }, []);
    return (
        <resolverCtx.Provider value={resolver}>
            <setupCtx.Provider value={setup}>{props.children}</setupCtx.Provider>;
        </resolverCtx.Provider>
    );
};

export const useJMESPath = (): rd.Resolvable<JMESPathBindings> => React.useContext(setupCtx)!;
export const useJMESPathResolver = (): rd.Resolver<JMESPathBindings> => React.useContext(resolverCtx)!;
