import * as React from 'react';
import { type JsonViewProps } from './index.js';
import { useShowTools, ShowTools } from './store/show_tools.js';
import { useExpands, Expands } from './store/expands.js';

export type BlockTagType = keyof JSX.IntrinsicElements;

export interface InitialState<T extends object> {
    value?: object;
    onExpand?: JsonViewProps<object>['onExpand'];
    onCopied?: JsonViewProps<object>['onCopied'];
    beforeCopy?: JsonViewProps<T>['beforeCopy'];
    objectSortKeys?: JsonViewProps<T>['objectSortKeys'];
    displayObjectSize?: JsonViewProps<T>['displayObjectSize'];
    shortenTextAfterLength?: JsonViewProps<T>['shortenTextAfterLength'];
    stringEllipsis?: JsonViewProps<T>['stringEllipsis'];
    enableClipboard?: JsonViewProps<T>['enableClipboard'];
    highlightUpdates?: JsonViewProps<T>['highlightUpdates'];
    collapsed?: JsonViewProps<T>['collapsed'];
    shouldExpandNodeInitially?: JsonViewProps<T>['shouldExpandNodeInitially'];
    indentWidth?: number;
}

export const initialState: InitialState<object> = {
    objectSortKeys: false,
    indentWidth: 15,
};

type Dispatch = React.Dispatch<InitialState<object>>;

export const Context = React.createContext<InitialState<object>>(initialState);
Context.displayName = 'JVR.Context';

const DispatchContext = React.createContext<Dispatch>(() => { });
DispatchContext.displayName = 'JVR.DispatchContext';

export function reducer(state: InitialState<object>, action: InitialState<object>): InitialState<object> {
    return {
        ...state,
        ...action,
    };
}

export const useStore = () => {
    return React.useContext(Context);
};

export const useDispatchStore = () => {
    return React.useContext(DispatchContext);
};

export interface ProviderProps {
    initialState?: InitialState<object>;
}

export const Provider = ({
    children,
    initialState: init,
}: React.PropsWithChildren<ProviderProps>) => {
    const [state, dispatch] = React.useReducer(reducer, Object.assign({}, initialState, init));
    const [showTools, showToolsDispatch] = useShowTools();
    const [expands, expandsDispatch] = useExpands();
    React.useEffect(() => dispatch({ ...init }), [init]);
    return (
        <Context.Provider value={state}>
            <DispatchContext.Provider value={dispatch}>
                <ShowTools initial={showTools} dispatch={showToolsDispatch}>
                    <Expands initial={expands} dispatch={expandsDispatch}>
                        {children}
                    </Expands>
                </ShowTools>
            </DispatchContext.Provider>
        </Context.Provider>
    );
};

export function useDispatch() {
    return React.useContext(DispatchContext);
}

Provider.displayName = 'JVR.Provider';
