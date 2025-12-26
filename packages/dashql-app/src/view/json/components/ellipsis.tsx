import * as React from 'react';

export interface EllipsisCompProps<T extends object> {
    value?: T;
    keyName: string | number;
    isExpanded: boolean;
}

export function EllipsisComp<T extends object>({ isExpanded, value }: EllipsisCompProps<T>) {
    if (!isExpanded || (typeof value === 'object' && Object.keys(value).length == 0)) return null;

    return (
        <span
            className="w-rjv-ellipsis"
            style={{
                cursor: 'pointer',
                color: 'var(--w-rjv-ellipsis-color, #cb4b16)',
                userSelect: 'none',
            }}
        >
            ...
        </span>
    );
};
