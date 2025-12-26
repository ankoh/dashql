import * as React from 'react';

export interface SectionElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    /** Index of the parent `keyName` */
    keys?: K[];
}

export const Row = (_props: React.HTMLAttributes<HTMLDivElement>) => {
    return null;
};

Row.displayName = 'JVR.Row';

export interface RowCompProps<T extends object> extends React.HTMLAttributes<HTMLDivElement>, SectionElementResult<T> { }

export const RowComp = <T extends object>(props: React.PropsWithChildren<RowCompProps<T>>) => {
    const { children, value, parentValue, keyName, keys, ...other } = props;

    return (
        <div className="w-rjv-line" {...other}>
            {children}
        </div>
    );
};

RowComp.displayName = 'JVR.RowComp';
