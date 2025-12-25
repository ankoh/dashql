import * as React from 'react';
import { useSymbolsStore, type SymbolsElement } from '../store/symbols.js';
import { type TagType } from '../store/types.js';
import { useSymbolsRender } from '../utils/use_render.js';

export const BracketsRight = <K extends TagType = 'span'>(props: SymbolsElement<K>) => {
    const { BracketsRight: Comp = {} } = useSymbolsStore();
    useSymbolsRender(Comp, props, 'BracketsRight');

    return null;
};

BracketsRight.displayName = 'JVR.BracketsRight';
