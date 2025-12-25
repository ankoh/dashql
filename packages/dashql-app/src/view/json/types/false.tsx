import * as React from 'react';
import { useTypesStore, type TagType, type TypesElement } from '../store/types.js';
import { useTypesRender } from '../utils/use_render.js';

export const False = <K extends TagType = 'span'>(props: TypesElement<K>) => {
    const { False: Comp = {} } = useTypesStore();
    useTypesRender(Comp, props, 'False');

    return null;
};

False.displayName = 'JVR.False';
