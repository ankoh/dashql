import * as React from 'react';

type InitialState = Record<string, boolean>;
type Dispatch = React.Dispatch<InitialState>;

const initialState: InitialState = {};
const Context = React.createContext<InitialState>(initialState);

const reducer = (state: InitialState, action: InitialState) => ({
    ...state,
    ...action,
});

export const useToolVisibilityStore = () => {
    return React.useContext(Context);
};

const DispatchShowTools = React.createContext<Dispatch>(() => { });

export function useToolVisibilityReducer() {
    return React.useReducer(reducer, initialState);
}

export function useToolVisibilityDispatch() {
    return React.useContext(DispatchShowTools);
}

interface ShowToolsProps {
    initial: InitialState;
    dispatch: Dispatch;
}

export const ToolVisibilityStateProvider: React.FC<React.PropsWithChildren<ShowToolsProps>> = ({ initial, dispatch, children }) => {
    return (
        <Context.Provider value={initial}>
            <DispatchShowTools.Provider value={dispatch}>{children}</DispatchShowTools.Provider>
        </Context.Provider>
    );
};
