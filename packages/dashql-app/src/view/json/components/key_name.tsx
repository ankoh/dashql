import * as React from 'react';

export interface SectionElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    /// Index of the parent `keyName`
    keys?: K[];
}

export interface KeyNameCompProps<T extends object>
    extends React.HTMLAttributes<HTMLSpanElement>,
    SectionElementResult<T> { }

export const KeyNameComp = <T extends object>(props: React.PropsWithChildren<KeyNameCompProps<T>>) => {
    const { children, value, parentValue, keyName, keys, ...other } = props;
    const isNumber = typeof children === 'number';
    const style: React.CSSProperties = {
        color: isNumber ? 'var(--w-rjv-key-number, #268bd2)' : 'var(--w-rjv-key-string, #002b36)',
    };

    return (
        <span className="w-rjv-object-key" style={style} {...other}>
            {children}
        </span>
    );
};
