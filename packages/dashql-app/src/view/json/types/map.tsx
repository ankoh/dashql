import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const Map = <K extends TagType = 'span'>(props: TypesElement<K>) => {
    const { Map: Comp = {} } = useTypesStore();
    useTypesRender(Comp, props, 'Map');

    return null;
};

Map.displayName = 'JVR.Map';
