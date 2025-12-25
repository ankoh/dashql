import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const Undefined = <K extends TagType = 'span'>(props: TypesElement<K>) => {
    const { Undefined: Comp = {} } = useTypesStore();
    useTypesRender(Comp, props, 'Undefined');

    return null;
};

Undefined.displayName = 'JVR.Undefined';
