import * as React from 'react';
import { SEQ_SINGLE_HUE_PRIMARY } from '../utils';
import { ComposableMap, Graticule, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';

import world_110m from '../../static/geo/world-110m.json';

interface Props {
    className?: string;
    width: number;
    height: number;
}

const COLOR_PALETTE = SEQ_SINGLE_HUE_PRIMARY;

export const ActivityMap: React.FC<Props> = (props: Props) => (
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
