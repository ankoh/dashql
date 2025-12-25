import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const Bigint = <K extends TagType = 'span'>(props: TypesElement<K>) => {
  const { Bigint: Comp = {} } = useTypesStore();
  useTypesRender(Comp, props, 'Bigint');

  return null;
};

Bigint.displayName = 'JVR.Bigint';
