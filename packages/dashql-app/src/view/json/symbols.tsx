import * as React from 'react';

import icons from '../../../static/svg/symbols.generated.svg';

import { useNestedExpansionState } from './json_nested_state.js';

export interface SymbolsElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    keyPath?: K[];
}

export const Arrow = <K extends object>(
    props: { expandKey: string; style?: React.CSSProperties } & SymbolsElementResult<K>,
) => {
    const expands = useNestedExpansionState();
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

