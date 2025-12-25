import * as React from 'react';
import { useSymbolsStore, type SymbolsElement } from '../store/symbols.js';
import { type TagType } from '../store/symbols.js';
import { useSymbolsRender } from '../utils/use_render.js';

export const BraceLeft = <K extends TagType = 'span'>(props: SymbolsElement<K>) => {
    const { BraceLeft: Comp = {} } = useSymbolsStore();
    useSymbolsRender(Comp, props, 'BraceLeft');

    return null;
};

BraceLeft.displayName = 'JVR.BraceLeft';
