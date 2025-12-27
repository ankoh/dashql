import * as React from 'react';

import icons from '../../../static/svg/symbols.generated.svg';

import { useNodeExpansionState } from './state/json_node_expansion_state.js';
import { isValidIndex } from '@dnd-kit/sortable/dist/utilities/isValidIndex.js';

export interface SymbolsElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    /// Index of the parent `keyName`
    keys?: K[];
}

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

export const Arrow = <K extends object>(
    props: { expandKey: string; style?: React.CSSProperties } & SymbolsElementResult<K>,
) => {
    const expands = useNodeExpansionState();
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

export const JsonBracketsOpen = <K extends object>(props: { isBrackets?: boolean } & SymbolsElementResult<K>) => {
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
    isVisible?: boolean;
};

export const JsonBracketsClose = <K extends object>(props: BracketsProps & SymbolsElementResult<K>) => {
    const { isBrackets, isVisible: isVisible } = props;
    if (!isVisible) return null;
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
