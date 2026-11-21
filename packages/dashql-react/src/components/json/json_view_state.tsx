import * as React from 'react';

import { type JsonViewProps } from './json_view.js';
import { ToolVisibilityStore, ToolVisibilityStateProvider } from './json_tool_state.js';
import { useNestedExpansionReducer, NestedExpansionStateProvider } from './json_nested_state.js';

export interface JsonViewerState {
    variant: NonNullable<JsonViewProps['variant']>;
    arrayPageSize: number;
    collapsed: boolean | number;
    shortenTextAfterLength: number;
    beforeCopy?: JsonViewProps['beforeCopy'];
}

const Context = React.createContext<JsonViewerState>({
    variant: 'json',
    arrayPageSize: 0,
    collapsed: false,
    shortenTextAfterLength: 30,
});

export const useJsonViewerState = () => {
    return React.useContext(Context);
};

/// Is a node of a level expanded before the user expands or collapses it?
export function expandedInitially(collapsed: boolean | number, level: number): boolean {
    return typeof collapsed === 'number' ? level <= collapsed : !collapsed;
}

export const JsonViewerStateProvider = ({ children, state }: React.PropsWithChildren<{ state: JsonViewerState }>) => {
    const [toolStore] = React.useState(() => new ToolVisibilityStore());
    const [expands, expandsDispatch] = useNestedExpansionReducer();
    return (
        <Context.Provider value={state}>
            <ToolVisibilityStateProvider store={toolStore}>
                <NestedExpansionStateProvider initial={expands} dispatch={expandsDispatch}>
                    {children}
                </NestedExpansionStateProvider>
            </ToolVisibilityStateProvider>
        </Context.Provider>
    );
};
