import * as React from 'react';
import * as styles from './notebook_page_overview.module.css';

import { classNames } from '../../utils/classnames.js';

interface EdgeLayerProps {
    className?: string;
    width: number;
    height: number;

    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;

    paths: React.ReactNode;
}

/// SVG layer that holds the dependency edge `<path>` elements.
///
/// Revived from the removed catalog viewer's EdgeLayer. Shares identical padding
/// with NodeLayer so edge coordinates align with the card rectangles. The
/// catalog's `scale(-1, 1)` horizontal mirror (its tree grew right-to-left) is
/// intentionally dropped — the overview grid is drawn left-to-right.
export function EdgeLayer(props: EdgeLayerProps) {
    return (
        <div
            className={classNames(styles.layer_container, props.className)}
            style={{
                paddingTop: props.paddingTop,
                paddingRight: props.paddingRight,
                paddingBottom: props.paddingBottom,
                paddingLeft: props.paddingLeft,
            }}
        >
            <svg
                className={styles.layer_body}
                viewBox={`0 0 ${props.width} ${props.height}`}
                width={props.width}
                height={props.height}
            >
                {props.paths}
            </svg>
        </div>
    );
}
