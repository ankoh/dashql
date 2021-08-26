// Copyright (c) 2021 The DashQL Authors

import React from 'react';
import { JMESPathBindings } from './jmespath_bindings';

type Props = {
    children: React.ReactElement;
    resolver: () => Promise<JMESPathBindings>;
};

const ctx = React.createContext<(() => Promise<JMESPathBindings>) | null>(null);
export const JMESPathProvider: React.FC<Props> = (props: Props) => {
    const bindings = React.useRef<JMESPathBindings | null>(null);
    const resolveAndCache = React.useCallback(async () => {
        if (bindings.current == null) {
            bindings.current = await props.resolver();
        }
        return bindings.current;
    }, [props.resolver]);
    return <ctx.Provider value={resolveAndCache}>{props.children}</ctx.Provider>;
};
export const useJMESPathResolver = (): (() => Promise<JMESPathBindings>) => React.useContext(ctx)!;
