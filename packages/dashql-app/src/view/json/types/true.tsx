import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const True = <K extends TagType = 'span'>(props: TypesElement<K>) => {
    const { True: Comp = {} } = useTypesStore();
    useTypesRender(Comp, props, 'True');

    return null;
};

True.displayName = 'JVR.True';
