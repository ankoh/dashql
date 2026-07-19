import * as React from 'react';
import * as styles from './notebook_page_overview.module.css';

import { classNames } from '../../utils/classnames.js';

interface NodeLayerProps {
    className?: string;
    width: number;
    height: number;

    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;

    nodes: React.ReactNode;
}

/// HTML layer that holds the absolutely-positioned overview cards.
///
/// Revived from the removed catalog viewer's NodeLayer. Shares identical padding
/// with EdgeLayer so card rectangles and edge coordinates align in one padded
/// coordinate space.
export function NodeLayer(props: NodeLayerProps) {
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
            <div
                className={styles.layer_body}
                style={{
                    width: props.width,
                    height: props.height,
                }}
            >
                {props.nodes}
            </div>
        </div>
    );
}
