import * as React from 'react';
import { useSymbolsStore, type SymbolsElement } from '../store/symbols.js';
import { type TagType } from '../store/symbols.js';
import { useSymbolsRender } from '../utils/use_render.js';

export const Quote = <K extends TagType = 'span'>(props: SymbolsElement<K>) => {
    const { Quote: Comp = {} } = useSymbolsStore();
    useSymbolsRender(Comp, props, 'Quote');

    return null;
};

Quote.displayName = 'JVR.Quote';
