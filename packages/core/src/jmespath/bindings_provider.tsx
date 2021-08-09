import React from 'react';
import { JMESPathBindings } from './bindings';

type Props = {
    children: React.ReactElement;
    jmespath: JMESPathBindings;
};

const ctx = React.createContext<JMESPathBindings | null>(null);
export const JMESPathProvider: React.FC<Props> = (props: Props) => {
    return <ctx.Provider value={props.jmespath}>{props.children}</ctx.Provider>;
};
export const useJMESPath = (): JMESPathBindings => React.useContext(ctx);
