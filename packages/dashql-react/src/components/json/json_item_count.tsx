import * as React from 'react';
import * as styles from './json_view.module.css';

export interface CountInfoCompProps<T extends object> {
    value?: T;
}

export function JsonItemCount<T extends object>(
    props: CountInfoCompProps<T> & React.HTMLAttributes<HTMLElement>,
) {
    const len = Object.keys(props.value ?? {}).length;
    const children = `${len} item${len === 1 ? '' : 's'}`;

    return (
        <span className={styles.item_count}>
            {children}
        </span>
    );
};
