import * as React from 'react';
import { Controller } from './controller/Controller';

export interface IAppContext {
    controller: Controller,
}

const ctxt = React.createContext<IAppContext | null>(null);
export const AppContextProvider = ctxt.Provider;
export const AppContextConsumer = ctxt.Consumer;

export function withAppContext<
    ALL_PROPS extends { appContext?: IAppContext },
    RAW_PROPS = Pick<ALL_PROPS, Exclude<keyof ALL_PROPS, 'appContext'>>
>(Component: React.ComponentClass<ALL_PROPS> | React.StatelessComponent<ALL_PROPS>): React.SFC<RAW_PROPS> {
        return function BoundComponent(props: RAW_PROPS) {
            return (
                <AppContextConsumer>
                    {value => <Component {...(Object.assign({} as ALL_PROPS, props, {appContext: value}))}/>}
                </AppContextConsumer>
            );
        };
    }
