import * as React from 'react';
import * as styles from './catalog_viewer.module.css'

import { classNames } from '../../utils/classnames.js';

interface EdgeLayerProps {
    className?: string;
    width: number;
    height: number;

    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;

    paths: React.ReactElement[];
}

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
                <g transform={`translate(${props.width / 2}, 0) scale(-1, 1) translate(-${props.width / 2}, 0)`}>
                    {props.paths}
                </g>
            </svg>
        </div>
    );
}
