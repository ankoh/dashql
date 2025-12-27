import * as React from 'react';

import { type JsonViewProps } from './json_view.js';
import { useToolVisibilityReducer, ToolVisibilityStateProvider } from './json_tool_state.js';
import { useNestedExpansionReducer, NestedExpansionStateProvider } from './json_nested_state.js';

export interface JsonViewerState {
    value?: object;
    onExpand?: JsonViewProps['onExpand'];
    onCopied?: JsonViewProps['onCopied'];
    beforeCopy?: JsonViewProps['beforeCopy'];
    objectSortKeys?: JsonViewProps['objectSortKeys'];
    displayObjectSize?: JsonViewProps['displayObjectSize'];
    shortenTextAfterLength?: JsonViewProps['shortenTextAfterLength'];
    stringEllipsis?: JsonViewProps['stringEllipsis'];
    enableClipboard?: JsonViewProps['enableClipboard'];
    highlightUpdates?: JsonViewProps['highlightUpdates'];
    collapsed?: JsonViewProps['collapsed'];
    shouldExpandNodeInitially?: JsonViewProps['shouldExpandNodeInitially'];
    indentWidth?: number;
}

export const initialState: JsonViewerState = {
    objectSortKeys: false,
    indentWidth: 15,
};

type Dispatch = React.Dispatch<JsonViewerState>;

export const Context = React.createContext<JsonViewerState>(initialState);

const DispatchContext = React.createContext<Dispatch>(() => { });

function reducer(state: JsonViewerState, action: JsonViewerState): JsonViewerState {
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
    initialState?: JsonViewerState;
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
