import * as React from 'react';
import * as styles from './json_view.module.css';

import { useJsonViewerState } from './json_view_state.js';

export function isFloat(n: number) { return (Number(n) === n && n % 1 !== 0) || isNaN(n); }

interface ValueProps {
    value: unknown;
}

export function JsonLiteral(props: ValueProps) {
    const { value } = props;
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
    const cls = shorten ? styles.literal_string_short : styles.literal_string;

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

function LiteralQuotes() {
    return (
        <span className={styles.literal_quotes}>
            "
        </span>
    );
};

function TrueLiteral() {
    return (
        <span className={styles.literal_true}>
            {true.toString()}
        </span>
    );
};

function FalseLiteral() {
    return (
        <span className={styles.literal_false}>
            {false.toString()}
        </span>
    );
};

function FloatLiteral(props: { children: number }) {
    return (
        <span className={styles.literal_float}>
            {props.children.toString()}
        </span>
    );
};

function IntLiteral(props: { children: number }) {
    return (
        <span className={styles.literal_int}>
            {props.children.toString()}
        </span>
    );
};

function BigintLiteral(props: { children: bigint }) {
    return (
        <span className={styles.literal_bigint}>
            {bigIntToString(props.children.toString())}
        </span>
    );
};

function UrlLiteral(props: { children: URL }) {
    return (
        <a className={styles.literal_url} href={props.children?.href} target="_blank" rel="noopener noreferrer">
            <LiteralQuotes />
            {props.children?.href}
            <LiteralQuotes />
        </a>
    );
};

function DateLiteral(props: { children?: Date }) {
    const childStr = props.children instanceof Date ? props.children.toLocaleString() : props.children;
    return (
        <span className={styles.literal_date}>
            {childStr}
        </span>
    );
};

function UndefinedLiteral() {
    return (
        <span className={styles.literal_undefined}>
            undefined
        </span>
    );
};

function NullLiteral() {
    return (
        <span className={styles.literal_null}>
            null
        </span>
    );
};

function NanLiteral() {
    return (
        <span className={styles.literal_nan}>
            nan
        </span>
    );
};
