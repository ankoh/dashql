import * as React from 'react';

import * as styles from './json_view.module.css';

export interface EllipsisCompProps<T extends object> {
    value?: T;
    keyName: string | number;
    isExpanded: boolean;
}

export function JsonEllipsis<T extends object>({ isExpanded, value }: EllipsisCompProps<T>) {
    if (isExpanded || (typeof value === 'object' && Object.keys(value).length == 0)) {
        return null;
    }
    return (
        <span className={styles.symbol_ellipsis}>
            ...
        </span>
    );
};
