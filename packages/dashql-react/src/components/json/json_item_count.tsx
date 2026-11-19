import * as React from 'react';
import * as styles from './json_view.module.css';
import { useJsonViewerState } from './json_view_state.js';

export interface CountInfoCompProps<T extends object> {
    value?: T;
}

export function JsonItemCount<T extends object>(
    props: CountInfoCompProps<T> & React.HTMLAttributes<HTMLElement>,
) {
    const { displayObjectSize } = useJsonViewerState();
    if (!displayObjectSize) return null;

    const len = Object.keys(props.value ?? {}).length;
    const children = `${len} item${len === 1 ? '' : 's'}`;

    return (
        <span className={styles.item_count}>
            {children}
        </span>
    );
};
