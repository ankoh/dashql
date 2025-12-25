import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const Nan = <K extends TagType = 'span'>(props: TypesElement<K>) => {
  const { Nan: Comp = {} } = useTypesStore();
  useTypesRender(Comp, props, 'Nan');

  return null;
};

Nan.displayName = 'JVR.Nan';
