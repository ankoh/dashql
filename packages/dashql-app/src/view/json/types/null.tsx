import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const Null = <K extends TagType = 'span'>(props: TypesElement<K>) => {
    const { Null: Comp = {} } = useTypesStore();
    useTypesRender(Comp, props, 'Null');

    return null;
};

Null.displayName = 'JVR.Null';
