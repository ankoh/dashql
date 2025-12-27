import * as React from 'react';

import icons from '../../../static/svg/symbols.generated.svg';

export function JsonArrowSymbol(props: { isExpanded: boolean }) {
    const style: React.CSSProperties = {
        transform: `rotate(${props.isExpanded ? '0' : '-90'}deg)`,
        transition: 'all 0.3s',
    };
    return (
        <span
            className="w-rjv-arrow"
            data-expanded={props.isExpanded}
            style={{
                transform: 'rotate(0deg)',
                transition: 'all 0.3s',
                ...style,
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

