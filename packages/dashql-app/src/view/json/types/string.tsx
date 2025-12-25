import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const StringText = <K extends TagType = 'span'>(props: TypesElement<K>) => {
    const { Str: Comp = {} } = useTypesStore();
    useTypesRender(Comp, props, 'Str');

    return null;
};

StringText.displayName = 'JVR.StringText';
