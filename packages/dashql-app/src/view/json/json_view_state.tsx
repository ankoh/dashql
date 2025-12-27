import * as React from 'react';

import { type JsonViewProps } from './json_view.js';
import { useToolVisibilityReducer, ToolVisibilityStateProvider } from './json_tool_state.js';
import { useNestedExpansionReducer, NestedExpansionStateProvider } from './json_nested_state.js';

export interface JsonViewerState<T extends object> {
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

export const initialState: JsonViewerState<object> = {
    objectSortKeys: false,
    indentWidth: 15,
};

type Dispatch = React.Dispatch<JsonViewerState<object>>;

export const Context = React.createContext<JsonViewerState<object>>(initialState);

const DispatchContext = React.createContext<Dispatch>(() => { });

function reducer(state: JsonViewerState<object>, action: JsonViewerState<object>): JsonViewerState<object> {
    return {
        ...state,
        ...action,
    };
}

export const useJsonViewerState = () => {
    return React.useContext(Context);
};

export const useJsonViewerDispatch = () => {
    return React.useContext(DispatchContext);
};

export interface JsonViewerStateProps {
    initialState?: JsonViewerState<object>;
}

export const JsonViewerStateProvider = ({
    children,
    initialState: init,
}: React.PropsWithChildren<JsonViewerStateProps>) => {
    const [state, dispatch] = React.useReducer(reducer, Object.assign({}, initialState, init));
    const [showTools, showToolsDispatch] = useToolVisibilityReducer();
    const [expands, expandsDispatch] = useNestedExpansionReducer();
    React.useEffect(() => dispatch({ ...init }), [init]);
    return (
        <Context.Provider value={state}>
            <DispatchContext.Provider value={dispatch}>
                <ToolVisibilityStateProvider initial={showTools} dispatch={showToolsDispatch}>
                    <NestedExpansionStateProvider initial={expands} dispatch={expandsDispatch}>
                        {children}
                    </NestedExpansionStateProvider>
                </ToolVisibilityStateProvider>
            </DispatchContext.Provider>
        </Context.Provider>
    );
};
