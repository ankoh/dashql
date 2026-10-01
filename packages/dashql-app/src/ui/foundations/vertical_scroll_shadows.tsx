import * as React from 'react';
import { createPortal } from 'react-dom';

import { classNames } from '../../utils/classnames.js';
import * as styles from './vertical_scroll_shadows.module.css';

const SCROLL_EDGE_TOLERANCE = 1;

export interface VerticalScrollOverflow {
    top: boolean;
    bottom: boolean;
}

export function getVerticalScrollOverflow(element: Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>): VerticalScrollOverflow {
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    return {
        top: element.scrollTop > SCROLL_EDGE_TOLERANCE,
        bottom: maxScrollTop - element.scrollTop > SCROLL_EDGE_TOLERANCE,
    };
}

interface VerticalScrollShadowsProps {
    getScrollElement: () => HTMLElement | null;
    portalContainer?: HTMLElement | null;
    prominent?: boolean;
    refreshKey?: unknown;
    rightInset?: number;
}

const NO_OVERFLOW: VerticalScrollOverflow = { top: false, bottom: false };

export const VerticalScrollShadows: React.FC<VerticalScrollShadowsProps> = ({
    getScrollElement,
    portalContainer,
    prominent = false,
    refreshKey,
    rightInset = 0,
}) => {
    const [overflow, setOverflow] = React.useState(NO_OVERFLOW);
    const updateOverflow = React.useCallback(() => {
        const element = getScrollElement();
        const next = element == null ? NO_OVERFLOW : getVerticalScrollOverflow(element);
        setOverflow(current => current.top === next.top && current.bottom === next.bottom ? current : next);
    }, [getScrollElement]);

    React.useLayoutEffect(() => {
        const element = getScrollElement();
        updateOverflow();
        if (element == null) return;

        element.addEventListener('scroll', updateOverflow, { passive: true });
        const resizeObserver = new ResizeObserver(updateOverflow);
        resizeObserver.observe(element);
        return () => {
            element.removeEventListener('scroll', updateOverflow);
            resizeObserver.disconnect();
        };
    }, [getScrollElement, refreshKey, updateOverflow]);

    const insetStyle = rightInset === 0 ? undefined : { right: rightInset };
    const shadows = (
        <>
            <div
                className={classNames(styles.shadow, styles.top, prominent && styles.prominent)}
                style={insetStyle}
                data-scroll-shadow="top"
                data-visible={overflow.top}
                aria-hidden="true"
            />
            <div
                className={classNames(styles.shadow, styles.bottom, prominent && styles.prominent)}
                style={insetStyle}
                data-scroll-shadow="bottom"
                data-visible={overflow.bottom}
                aria-hidden="true"
            />
        </>
    );
    if (portalContainer === null) return null;
    return portalContainer === undefined ? shadows : createPortal(shadows, portalContainer);
};
