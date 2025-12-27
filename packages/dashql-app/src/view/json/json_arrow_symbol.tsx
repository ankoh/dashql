import * as React from 'react';

import * as styles from './json_view.module.css';

import icons from '../../../static/svg/symbols.generated.svg';

export function JsonArrowSymbol(props: { isExpanded: boolean }) {
    const style: React.CSSProperties = {
        transform: `rotate(${props.isExpanded ? '0' : '-90'}deg)`,
        transition: 'all 0.3s',
    };
    return (
        <span
            className={styles.symbol_arrow_container}
            data-expanded={props.isExpanded}
            style={{
                transform: 'rotate(0deg)',
                transition: 'all 0.3s',
                ...style,
            }}
        >
            <svg
                className={styles.symbol_arrow}
                fill="currentColor"
            >
                <use xlinkHref={`${icons}#chevron_down_24`} />
            </svg>
        </span>
    );
};

