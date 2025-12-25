import * as React from 'react';
import { useSymbolsStore, type SymbolsElement } from '../store/symbols.js';
import { type TagType } from '../store/types.js';
import { useSymbolsRender } from '../utils/use_render.js';

export const Colon = <K extends TagType = 'span'>(props: SymbolsElement<K>) => {
  const { Colon: Comp = {} } = useSymbolsStore();
  useSymbolsRender(Comp, props, 'Colon');

  return null;
};

Colon.displayName = 'JVR.Colon';
