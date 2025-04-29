import * as React from 'react';
import * as styles from './catalog_viewer.module.css'

import { classNames } from '../../utils/classnames.js';

interface NodeLayerProps {
    className?: string;
    width: number;
    height: number;

    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;

    nodes: React.ReactElement[];
}

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
