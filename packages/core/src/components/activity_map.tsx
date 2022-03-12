import * as React from 'react';
import { SEQ_SINGLE_HUE_PRIMARY } from '../utils';
import { ComposableMap, Graticule, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { observeSize } from '../utils/size_observer';
import { clsx } from '../utils';
import styles from './activity_map.module.css';

import world_110m from '../../static/geo/world-110m.json';

interface MapProps {
    className?: string;
    width: number;
    height: number;
}

const COLOR_PALETTE = SEQ_SINGLE_HUE_PRIMARY;

export const ActivityMap: React.FC<MapProps> = (props: MapProps) => (
    <ComposableMap
        projection="geoEqualEarth"
        width={props.width}
        height={props.height}
        style={{ width: `${props.width}px`, height: `${props.height}px` }}
        className={props.className}
    >
        <ZoomableGroup center={[-10, 40]}>
            <Graticule stroke="rgb(220, 220, 220)" />
            <Geographies geography={world_110m}>
                {({ geographies }) =>
                    geographies.map(geo => {
                        const color = Math.floor(Math.random() * COLOR_PALETTE.length);
                        return (
                            <Geography
                                key={geo.rsmKey}
                                geography={geo}
                                fill={COLOR_PALETTE[color]}
                                stroke={COLOR_PALETTE[COLOR_PALETTE.length - 2]}
                            />
                        );
                    })
                }
            </Geographies>
        </ZoomableGroup>
    </ComposableMap>
);

interface ChartProps {
    className?: string;
}

export const ActivityMapChart: React.FC<ChartProps> = (props: ChartProps) => {
    const containerElement = React.useRef(null);
    const containerSize = observeSize(containerElement);
    return (
        <div className={clsx(styles.label_container, props.className)}>
            <div className={styles.label}>Views</div>
            <div ref={containerElement} className={styles.map_container}>
                {containerSize && (
                    <ActivityMap width={containerSize.width} height={containerSize.height} className={styles.map} />
                )}
            </div>
        </div>
    );
};
