import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const Float = <K extends TagType = 'span'>(props: TypesElement<K>) => {
    const { Float: Comp = {} } = useTypesStore();
    useTypesRender(Comp, props, 'Float');

    return null;
};

Float.displayName = 'JVR.Float';
