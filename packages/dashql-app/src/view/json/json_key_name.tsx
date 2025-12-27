import * as React from 'react';

export interface SymbolsElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    /// Index of the parent `keyName`
    keyPath?: K[];
}

export interface SectionElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    /// Index of the parent `keyName`
    keyPath?: K[];
}

export interface KeyNameCompProps<T extends object>
    extends React.HTMLAttributes<HTMLSpanElement>,
    SectionElementResult<T> { }

export function JsonKeyName<T extends object>(props: React.PropsWithChildren<KeyNameCompProps<T>>) {
    const { children, value, parentValue, keyName, keyPath, ...other } = props;
    const isNumber = typeof keyName === 'number';
    const style: React.CSSProperties = {
        color: isNumber ? 'var(--w-rjv-key-number, #268bd2)' : 'var(--w-rjv-key-string, #002b36)',
    };
    const childProps = { keyName, value, keyPath, parentValue };
    return (
        <React.Fragment>
            <span>
                <Quote isNumber={isNumber} data-placement="left" {...childProps} />
                <span className="w-rjv-object-key" style={style} {...other}>
                    {keyName}
                </span>
                <Quote isNumber={isNumber} data-placement="right" {...childProps} />
            </span>
            <Colon {...childProps} />
        </React.Fragment>
    );
};


function Quote<T extends object>(
    props: { isNumber?: boolean } & React.HTMLAttributes<HTMLElement> & SymbolsElementResult<T>,
) {
    const { isNumber, value, parentValue, keyName, keyPath, ...other } = props;
    if (isNumber) return null;
    return (
        <span
            {...other}
            style={{ color: 'var(--w-rjv-quotes-color, #236a7c)' }}
            className="w-rjv-quotes"
        >
            "
        </span>
    );
};


function Colon<T extends object>(_props: SymbolsElementResult<T>) {
    return (
        <span
            style={{
                color: 'var(--w-rjv-colon-color, var(--w-rjv-color))',
                marginLeft: 0,
                marginRight: 2,
            }}
            className="w-rjv-colon"
        >
            :
        </span>
    );
};
