import * as React from 'react';
import { useJsonViewerState } from './json_viewer_state.js';

export interface CountInfoCompProps<T extends object> {
    value?: T;
    keyName: string | number;
}

export function JsonItemCount<T extends object>(
    props: CountInfoCompProps<T> & React.HTMLAttributes<HTMLElement>,
) {
    const { value, keyName, ...other } = props;
    const { displayObjectSize } = useJsonViewerState();

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
