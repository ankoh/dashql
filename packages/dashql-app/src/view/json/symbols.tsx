import * as React from 'react';

import icons from '../../../static/svg/symbols.generated.svg';

import { useExpandsStore } from './store/expands.js';

export interface SymbolsElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    /** Index of the parent `keyName` */
    keys?: K[];
}

export const Quote = <T extends object>(
    props: { isNumber?: boolean } & React.HTMLAttributes<HTMLElement> & SymbolsElementResult<T>,
) => {
    const { isNumber, value, parentValue, keyName, keys, ...other } = props;
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

export const ValueQuote = (props: React.HTMLAttributes<HTMLElement>) => {
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

export const Colon = <T extends object>(_props: SymbolsElementResult<T>) => {
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

export const Arrow = <K extends object>(
    props: { expandKey: string; style?: React.CSSProperties } & SymbolsElementResult<K>,
) => {
    const expands = useExpandsStore();
    const { expandKey, style: resetStyle } = props;
    const isExpanded = !!expands[expandKey];
    return (
        <span
            className="w-rjv-arrow"
            data-expanded={isExpanded}
            style={{
                transform: 'rotate(0deg)',
                transition: 'all 0.3s',
                ...resetStyle,
            }}
        >
            <svg
                style={{
                    cursor: 'pointer',
                    height: '1em',
                    width: '1em',
                    userSelect: 'none',
                    display: 'inline-flex',
                }}
                fill="var(--w-rjv-arrow-color, currentColor)"
            >
                <use xlinkHref={`${icons}#chevron_down_24`} />
            </svg>
        </span>
    );
};

export const BracketsOpen = <K extends object>(props: { isBrackets?: boolean } & SymbolsElementResult<K>) => {
    const { isBrackets } = props;
    if (isBrackets) {
        return (
            <span
                style={{ color: 'var(--w-rjv-brackets-color, #236a7c)' }}
                className="w-rjv-brackets-start"
            >
                [
            </span>
        );
    }
    return (
        <span
            style={{ color: 'var(--w-rjv-curlybraces-color, #236a7c)' }}
            className="w-rjv-curlybraces-start"
        >
            {'{'}
        </span>
    );
};

type BracketsProps = {
    isBrackets?: boolean;
    isVisiable?: boolean;
};

export const BracketsClose = <K extends object>(props: BracketsProps & SymbolsElementResult<K>) => {
    const { isBrackets, isVisiable } = props;
    if (!isVisiable) return null;
    if (isBrackets) {
        return (
            <span
                style={{ color: 'var(--w-rjv-brackets-color, #236a7c)' }}
                className="w-rjv-brackets-end"
            >
                ]
            </span>
        );
    }
    return (
        <span
            style={{ color: 'var(--w-rjv-curlybraces-color, #236a7c)' }}
            className="w-rjv-curlybraces-end"
        >
            {'}'}
        </span>
    );
};
