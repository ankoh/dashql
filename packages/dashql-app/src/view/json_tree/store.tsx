import * as React from 'react';
import { type JsonViewProps } from './index.js';
import { useShowTools, ShowTools } from './store/show_tools.js';
import { useExpands, Expands } from './store/expands.js';
import { useTypes, Types, type InitialTypesState, type TagType } from './store/types.js';
import { useSymbols, Symbols } from './store/symbols.js';
import { useSection, Section } from './store/section.js';

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

export interface ProviderProps<T extends TagType> {
  initialState?: InitialState<object>;
  initialTypes?: InitialTypesState<T>;
}

export const Provider = <T extends TagType>({
  children,
  initialState: init,
  initialTypes,
}: React.PropsWithChildren<ProviderProps<T>>) => {
  const [state, dispatch] = React.useReducer(reducer, Object.assign({}, initialState, init));
  const [showTools, showToolsDispatch] = useShowTools();
  const [expands, expandsDispatch] = useExpands();
  const [types, typesDispatch] = useTypes();
  const [symbols, symbolsDispatch] = useSymbols();
  const [section, sectionDispatch] = useSection();
  React.useEffect(() => dispatch({ ...init }), [init]);
  return (
    <Context.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        <ShowTools initial={showTools} dispatch={showToolsDispatch}>
          <Expands initial={expands} dispatch={expandsDispatch}>
            <Types initial={{ ...types, ...initialTypes }} dispatch={typesDispatch}>
              <Symbols initial={symbols} dispatch={symbolsDispatch}>
                <Section initial={section} dispatch={sectionDispatch}>
                  {children}
                </Section>
              </Symbols>
            </Types>
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
