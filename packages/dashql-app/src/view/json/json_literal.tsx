import * as React from 'react';
import { useJsonViewerState } from './json_viewer_state.js';

export function isFloat(n: number) { return (Number(n) === n && n % 1 !== 0) || isNaN(n); }

interface ValueProps {
    value: unknown;
    keyName: string | number;
}

export function JsonLiteral(props: ValueProps) {
    const { value, keyName } = props;
    if (value instanceof URL) {
        return <UrlLiteral>{value}</UrlLiteral>;
    }
    if (typeof value === 'string') {
        return <StringLiteral>{value}</StringLiteral>;
    }
    if (value === true) {
        return <TrueLiteral />;
    }
    if (value === false) {
        return <FalseLiteral />;
    }
    if (value === null) {
        return <NullLiteral />;
    }
    if (value === undefined) {
        return <UndefinedLiteral />;
    }
    if (value instanceof Date) {
        return <DateLiteral>{value}</DateLiteral>;
    }

    if (typeof value === 'number' && isNaN(value)) {
        return <NanLiteral />;
    } else if (typeof value === 'number' && isFloat(value)) {
        return <FloatLiteral>{value}</FloatLiteral>;
    } else if (typeof value === 'bigint') {
        return <BigintLiteral>{value}</BigintLiteral>;
    } else if (typeof value === 'number') {
        return <IntLiteral>{value}</IntLiteral>;
    }

    return null;
};

export function bigIntToString(bi?: BigInt | string) {
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

type LiteralProps = React.PropsWithChildren<{
    keyName: string | number;
}>;

function StringLiteral(props: { children: string }) {
    const { shortenTextAfterLength: length = 30, stringEllipsis = '...' } = useJsonViewerState();
    const childrenStr = props.children as string;
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
            <LiteralQuotes />
            <span className={cls} style={style} onClick={onClick}>
                {text}
            </span>
            <LiteralQuotes />
        </React.Fragment>
    );
};

function LiteralQuotes(props: React.HTMLAttributes<HTMLElement>) {
    return (
        <span
            {...props}
            style={{ color: 'var(--w-rjv-quotes-string-color, #cb4b16)' }}
            className="w-rjv-quotes"
        >
            "
        </span>
    );
};

function TrueLiteral() {
    return (
        <span className="w-rjv-value">
            {true.toString()}
        </span>
    );
};

function FalseLiteral() {
    return (
        <span className="w-rjv-value">
            {false.toString()}
        </span>
    );
};

function FloatLiteral(props: { children: number }) {
    return (
        <span className="w-rjv-value">
            {props.children.toString()}
        </span>
    );
};

function IntLiteral(props: { children: number }) {
    return (
        <span className="w-rjv-value">
            {props.children.toString()}
        </span>
    );
};

function BigintLiteral(props: { children: bigint }) {
    return (
        <span className="w-rjv-value">
            {bigIntToString(props.children.toString())}
        </span>
    );
};

function UrlLiteral(props: { children: URL }) {
    return (
        <a href={props.children?.href} target="_blank" rel="noopener noreferrer" className="w-rjv-value">
            <LiteralQuotes />
            {props.children?.href}
            <LiteralQuotes />
        </a>
    );
};

function DateLiteral(props: { children?: Date }) {
    const childStr = props.children instanceof Date ? props.children.toLocaleString() : props.children;
    return (
        <span className="w-rjv-value">
            {childStr}
        </span>
    );
};

function UndefinedLiteral() {
    return (
        <span className="w-rjv-value">
            undefined
        </span>
    );
};

function NullLiteral() {
    return (
        <span className="w-rjv-value">
            null
        </span>
    );
};

function NanLiteral() {
    return (
        <span className="w-rjv-value">
            nan
        </span>
    );
};
