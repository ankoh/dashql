import * as React from 'react';
import { useSymbolsStore, type SymbolsElement } from '../store/symbols.js';
import { type TagType } from '../store/symbols.js';
import { useSymbolsRender } from '../utils/use_render.js';

export const ValueQuote = <K extends TagType = 'span'>(props: SymbolsElement<K>) => {
    const { ValueQuote: Comp = {} } = useSymbolsStore();
    useSymbolsRender(Comp, props, 'ValueQuote');

    return null;
};

ValueQuote.displayName = 'JVR.ValueQuote';
