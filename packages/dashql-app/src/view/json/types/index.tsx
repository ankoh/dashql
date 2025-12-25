import * as React from 'react';
import { type FC, Fragment, type PropsWithChildren, useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { ValueQuote } from '../symbol/index.js';

export const bigIntToString = (bi?: BigInt | string) => {
    if (bi === undefined) {
        return '0n';
    } else if (typeof bi === 'string') {
        try {
            bi = BigInt(bi);
        } catch (e) {
            return '0n';
        }
    }
    return bi ? bi.toString() + 'n' : '0n';
};

export const SetComp: FC<PropsWithChildren<{ value: unknown; keyName: string | number }>> = ({ value }) => {
    const isSet = value instanceof Set;
    if (!isSet) return null;
    return <span className="w-rjv-type" data-type="set" style={{ marginRight: 3 }}>Set</span>;
};

SetComp.displayName = 'JVR.SetComp';

export const MapComp: FC<PropsWithChildren<{ value: unknown; keyName: string | number }>> = ({ value }) => {
    const isMap = value instanceof Map;
    if (!isMap) return null;
    return <span className="w-rjv-type" data-type="map" style={{ marginRight: 3 }}>Map</span>;
};

MapComp.displayName = 'JVR.MapComp';

type TypeProps = PropsWithChildren<{
    keyName: string | number;
    keys?: (string | number)[];
}>;

export const TypeString: FC<TypeProps> = ({ children = '' }) => {
    const { shortenTextAfterLength: length = 30, stringEllipsis = '...' } = useStore();
    const childrenStr = children as string;
    const [shorten, setShorten] = useState(length && childrenStr.length > length);
    useEffect(() => setShorten(length && childrenStr.length > length), [length]);

    const style: React.CSSProperties = length > 0 ? {
        cursor: childrenStr.length <= length ? 'initial' : 'pointer',
    } : {};

    const onClick = length > 0 && childrenStr.length > length ? () => setShorten(!shorten) : undefined;
    const text = shorten ? `${childrenStr.slice(0, length)}${stringEllipsis}` : childrenStr;
    const cls = shorten ? 'w-rjv-value w-rjv-value-short' : 'w-rjv-value';

    return (
        <Fragment>
            <ValueQuote />
            <span className={cls} style={style} onClick={onClick}>
                {text}
            </span>
            <ValueQuote />
        </Fragment>
    );
};

TypeString.displayName = 'JVR.TypeString';

export const TypeTrue: FC<TypeProps> = ({ children }) => {
    return (
        <span className="w-rjv-value">
            {children?.toString()}
        </span>
    );
};

TypeTrue.displayName = 'JVR.TypeTrue';

export const TypeFalse: FC<TypeProps> = ({ children }) => {
    return (
        <span className="w-rjv-value">
            {children?.toString()}
        </span>
    );
};

TypeFalse.displayName = 'JVR.TypeFalse';

export const TypeFloat: FC<TypeProps> = ({ children }) => {
    return (
        <span className="w-rjv-value">
            {children?.toString()}
        </span>
    );
};

TypeFloat.displayName = 'JVR.TypeFloat';

export const TypeInt: FC<TypeProps> = ({ children }) => {
    return (
        <span className="w-rjv-value">
            {children?.toString()}
        </span>
    );
};

TypeInt.displayName = 'JVR.TypeInt';

export const TypeBigint: FC<{ children?: BigInt } & Omit<TypeProps, 'children'>> = ({ children }) => {
    return (
        <span className="w-rjv-value">
            {bigIntToString(children?.toString())}
        </span>
    );
};

TypeBigint.displayName = 'JVR.TypeBigint';

export const TypeUrl: FC<{ children?: URL } & Omit<TypeProps, 'children'>> = ({ children }) => {
    return (
        <a href={children?.href} target="_blank" rel="noopener noreferrer" className="w-rjv-value">
            <ValueQuote />
            {children?.href}
            <ValueQuote />
        </a>
    );
};

TypeUrl.displayName = 'JVR.TypeUrl';

export const TypeDate: FC<{ children?: Date } & Omit<TypeProps, 'children'>> = ({ children }) => {
    const childStr = children instanceof Date ? children.toLocaleString() : children;
    return (
        <span className="w-rjv-value">
            {childStr}
        </span>
    );
};

TypeDate.displayName = 'JVR.TypeDate';

export const TypeUndefined: FC<TypeProps> = () => {
    return null;
};

TypeUndefined.displayName = 'JVR.TypeUndefined';

export const TypeNull: FC<TypeProps> = () => {
    return null;
};

TypeNull.displayName = 'JVR.TypeNull';

export const TypeNan: FC<TypeProps> = () => {
    return null;
};

TypeNan.displayName = 'JVR.TypeNan';
