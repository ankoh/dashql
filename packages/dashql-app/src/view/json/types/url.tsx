import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const Url = <K extends TagType = 'a'>(props: TypesElement<K>) => {
    const { Url: Comp = {} } = useTypesStore();
    useTypesRender(Comp, props, 'Url');

    return null;
};

Url.displayName = 'JVR.Url';
