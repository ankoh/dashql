import * as React from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';

import world_110m from '../../static/geo/world-110m.json';

interface Props {
    className?: string;
    width: number;
    height: number;
}

export const ActivityMap: React.FC<Props> = (props: Props) => (
    <ComposableMap
        projection="geoEqualEarth"
        width={props.width}
        height={props.height}
        style={{ width: `${props.width}px`, height: `${props.height}px` }}
        className={props.className}
    >
        <ZoomableGroup center={[-10, 40]}>
            <Geographies geography={world_110m}>
                {({ geographies }) => geographies.map(geo => <Geography key={geo.rsmKey} geography={geo} />)}
            </Geographies>
        </ZoomableGroup>
    </ComposableMap>
);
