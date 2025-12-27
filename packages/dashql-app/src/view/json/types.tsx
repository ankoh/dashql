import * as React from 'react';
import { useJsonViewerState } from './state/json_viewer_state.js';
import { ValueQuote } from './symbols.js';

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

export const SetComp: React.FC<React.PropsWithChildren<{ value: unknown; keyName: string | number }>> = ({ value }) => {
    const isSet = value instanceof Set;
    if (!isSet) return null;
    return <span className="w-rjv-type" data-type="set" style={{ marginRight: 3 }}>Set</span>;
};

export const MapComp: React.FC<React.PropsWithChildren<{ value: unknown; keyName: string | number }>> = ({ value }) => {
    const isMap = value instanceof Map;
    if (!isMap) return null;
    return <span className="w-rjv-type" data-type="map" style={{ marginRight: 3 }}>Map</span>;
};

type TypeProps = React.PropsWithChildren<{
    keyName: string | number;
    keys?: (string | number)[];
}>;

export const TypeString: React.FC<TypeProps> = ({ children = '' }) => {
    const { shortenTextAfterLength: length = 30, stringEllipsis = '...' } = useJsonViewerState();
    const childrenStr = children as string;
    const [shorten, setShorten] = React.useState(length && childrenStr.length > length);
    React.useEffect(() => setShorten(length && childrenStr.length > length), [length]);

    const style: React.CSSProperties = length > 0 ? {
        cursor: childrenStr.length <= length ? 'initial' : 'pointer',
    } : {};

    const onClick = length > 0 && childrenStr.length > length ? () => setShorten(!shorten) : undefined;
    const text = shorten ? `${childrenStr.slice(0, length)}${stringEllipsis}` : childrenStr;
    const cls = shorten ? 'w-rjv-value w-rjv-value-short' : 'w-rjv-value';

    return (
        <React.Fragment>
            <ValueQuote />
            <span className={cls} style={style} onClick={onClick}>
                {text}
            </span>
            <ValueQuote />
        </React.Fragment>
    );
};

export const TypeTrue: React.FC<TypeProps> = ({ children }) => {
    return (
        <span className="w-rjv-value">
            {children?.toString()}
        </span>
    );
};

export const TypeFalse: React.FC<TypeProps> = ({ children }) => {
    return (
        <span className="w-rjv-value">
            {children?.toString()}
        </span>
    );
};

export const TypeFloat: React.FC<TypeProps> = ({ children }) => {
    return (
        <span className="w-rjv-value">
            {children?.toString()}
        </span>
    );
};

export const TypeInt: React.FC<TypeProps> = ({ children }) => {
    return (
        <span className="w-rjv-value">
            {children?.toString()}
        </span>
    );
};

export const TypeBigint: React.FC<{ children?: BigInt } & Omit<TypeProps, 'children'>> = ({ children }) => {
    return (
        <span className="w-rjv-value">
            {bigIntToString(children?.toString())}
        </span>
    );
};

export const TypeUrl: React.FC<{ children?: URL } & Omit<TypeProps, 'children'>> = ({ children }) => {
    return (
        <a href={children?.href} target="_blank" rel="noopener noreferrer" className="w-rjv-value">
            <ValueQuote />
            {children?.href}
            <ValueQuote />
        </a>
    );
};

export const TypeDate: React.FC<{ children?: Date } & Omit<TypeProps, 'children'>> = ({ children }) => {
    const childStr = children instanceof Date ? children.toLocaleString() : children;
    return (
        <span className="w-rjv-value">
            {childStr}
        </span>
    );
};

export const TypeUndefined: React.FC<TypeProps> = () => {
    return null;
};

export const TypeNull: React.FC<TypeProps> = () => {
    return null;
};

export const TypeNan: React.FC<TypeProps> = () => {
    return null;
};

TypeNan.displayName = 'JVR.TypeNan';
