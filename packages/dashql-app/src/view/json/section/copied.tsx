import * as React from 'react';
import { type TagType } from '../store/types.js';
import { type SectionElement, useSectionStore } from '../store/section.js';
import { useSectionRender } from '../utils/use_render.js';

export type CopiedSectionElement<T extends TagType = 'svg'> = SectionElement<T> & {
    beforeCopy?: (
        copyText: string,
        keyName?: string | number,
        value?: object,
        parentValue?: object,
        expandKey?: string,
        keys?: (number | string)[],
    ) => string;
};

export const Copied = <K extends TagType = 'svg'>(props: CopiedSectionElement<K>) => {
    const { Copied: Comp = {} } = useSectionStore();
    useSectionRender(Comp, props, 'Copied');
    return null;
};

Copied.displayName = 'JVR.Copied';
