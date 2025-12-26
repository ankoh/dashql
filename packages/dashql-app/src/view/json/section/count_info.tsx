import * as React from 'react';
import { useStore } from '../store.js';

export interface SectionElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    /** Index of the parent `keyName` */
    keys?: K[];
}

export const CountInfo = (_props: React.HTMLAttributes<HTMLSpanElement>) => {
    return null;
};

CountInfo.displayName = 'JVR.CountInfo';

export interface CountInfoCompProps<T extends object> {
    value?: T;
    keyName: string | number;
}

export const CountInfoComp = <T extends object>(
    props: CountInfoCompProps<T> & React.HTMLAttributes<HTMLElement>,
) => {
    const { value, keyName, ...other } = props;
    const { displayObjectSize } = useStore();

    if (!displayObjectSize) return null;

    const len = Object.keys(value ?? {}).length;
    const children = `${len} item${len === 1 ? '' : 's'}`;

    return (
        <span
            className="w-rjv-object-size"
            style={{
                color: 'var(--w-rjv-info-color, #0000004d)',
                paddingLeft: 8,
                fontStyle: 'italic',
            }}
            {...other}
        >
            {children}
        </span>
    );
};
