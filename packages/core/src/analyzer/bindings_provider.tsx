// Copyright (c) 2020 The DashQL Authors

import React from 'react';
import { AnalyzerBindings } from './bindings';

type Props = {
    children: React.ReactElement;
    analyzer: AnalyzerBindings;
};

const ctx = React.createContext<AnalyzerBindings | null>(null);
export const AnalyzerProvider: React.FC<Props> = (props: Props) => {
    return <ctx.Provider value={props.analyzer}>{props.children}</ctx.Provider>;
};
export const useAnalyzer = (): AnalyzerBindings => React.useContext(ctx)!;
