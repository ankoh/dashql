import * as React from 'react';

export const CountInfoExtra = (_props: React.HTMLAttributes<HTMLSpanElement>) => {
    return null;
};

export interface CountInfoExtraCompsProps<T extends object> {
    value?: T;
    keyName: string | number;
}

export const CountInfoExtraComps = <T extends object>(
    _props: CountInfoExtraCompsProps<T>,
) => {
    // This component only renders when a custom render prop is provided
    // Since we've removed the section store, this now returns null by default
    return null;
};
