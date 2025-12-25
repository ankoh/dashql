import * as React from 'react';
import { useSymbolsStore, type SymbolsElement } from '../store/symbols.js';
import { type TagType } from '../store/types.js';
import { useSymbolsRender } from '../utils/use_render.js';

export const Arrow = <K extends TagType = 'span'>(props: SymbolsElement<K>) => {
    const { Arrow: Comp = {} } = useSymbolsStore();
    useSymbolsRender(Comp, props, 'Arrow');
    return null;
};

Arrow.displayName = 'JVR.Arrow';
