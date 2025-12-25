import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const Date = <K extends TagType = 'span'>(props: TypesElement<K>) => {
  const { Date: Comp = {} } = useTypesStore();
  useTypesRender(Comp, props, 'Date');

  return null;
};

Date.displayName = 'JVR.Date';
