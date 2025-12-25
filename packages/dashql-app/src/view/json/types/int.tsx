import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const Int = <K extends TagType = 'span'>(props: TypesElement<K>) => {
    const { Int: Comp = {} } = useTypesStore();
    useTypesRender(Comp, props, 'Int');

    return null;
};

Int.displayName = 'JVR.Int';
