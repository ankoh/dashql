import * as React from 'react';
import { useSymbolsStore, type SymbolsElement } from '../store/symbols.js';
import { type TagType } from '../store/symbols.js';
import { useSymbolsRender } from '../utils/use_render.js';

export const BraceRight = <K extends TagType = 'span'>(props: SymbolsElement<K>) => {
    const { BraceRight: Comp = {} } = useSymbolsStore();
    useSymbolsRender(Comp, props, 'BraceRight');
    return null;
};

BraceRight.displayName = 'JVR.BraceRight';
