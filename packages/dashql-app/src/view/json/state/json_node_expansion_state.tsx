import * as React from 'react';

type InitialState = {
    [key: string]: boolean;
};

type Dispatch = React.Dispatch<InitialState>;

const initialState: InitialState = {};
const Context = React.createContext<InitialState>(initialState);

const reducer = (state: InitialState, action: InitialState) => ({
    ...state,
    ...action,
});

export const useNodeExpansionState = () => {
    return React.useContext(Context);
};

const DispatchExpands = React.createContext<Dispatch>(() => { });

export function useNodeExpansionReducer() {
    return React.useReducer(reducer, initialState);
}

export function useNodeExpansionDispatch() {
    return React.useContext(DispatchExpands);
}

interface ExpandsProps {
    initial: InitialState;
    dispatch: Dispatch;
}

export const NodeExpansionStateProvider: React.FC<React.PropsWithChildren<ExpandsProps>> = ({ initial, dispatch, children }) => {
    return (
        <Context.Provider value={initial}>
            <DispatchExpands.Provider value={dispatch}>{children}</DispatchExpands.Provider>
        </Context.Provider>
    );
};
