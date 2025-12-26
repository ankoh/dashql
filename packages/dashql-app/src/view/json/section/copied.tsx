import * as React from 'react';

export interface SectionElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    /** Index of the parent `keyName` */
    keys?: K[];
}

export type CopiedSectionElement = {
    beforeCopy?: (
        copyText: string,
        keyName?: string | number,
        value?: object,
        parentValue?: object,
        expandKey?: string,
        keys?: (number | string)[],
    ) => string;
};

export const Copied = (_props: CopiedSectionElement) => {
    return null;
};

Copied.displayName = 'JVR.Copied';
