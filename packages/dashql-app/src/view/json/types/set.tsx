import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const Set = <K extends TagType = 'span'>(props: TypesElement<K>) => {
  const { Set: Comp = {} } = useTypesStore();
  useTypesRender(Comp, props, 'Set');

  return null;
};

Set.displayName = 'JVR.Set';
