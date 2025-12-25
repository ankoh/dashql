import * as React from 'react';
import { useSymbolsStore, type SymbolsElement } from '../store/symbols.js';
import { type TagType } from '../store/symbols.js';
import { useSymbolsRender } from '../utils/use_render.js';

export const BracketsLeft = <K extends TagType = 'span'>(props: SymbolsElement<K>) => {
    const { BracketsLeft: Comp = {} } = useSymbolsStore();
    useSymbolsRender(Comp, props, 'BracketsLeft');

    return null;
};

BracketsLeft.displayName = 'JVR.BracketsLeft';
