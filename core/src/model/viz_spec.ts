// Copyright (c) 2020 The DashQL Authors

import { proto } from "src/index_node";

/// The viz base spec
export interface VizSpec {
    readonly position: VizPosition;
    readonly components: VizComponentSpec[];
}

export interface VizComponentSpec {
    readonly type: proto.syntax.VizComponentType;
    readonly typeModifiers: Map<proto.syntax.VizComponentTypeModifier, boolean>;
    readonly styles: SVGStyleMap;
    readonly data: VizData;
    readonly selectionID: number | null;
}

/// A position
export interface VizPosition {
    readonly row: number;
    readonly column: number;
    readonly width: number;
    readonly height: number;
};

export interface VizData {
    readonly x?: string;
    readonly y?: string;
    readonly y0?: string;
    readonly categories?: string;
};

/// A style configuration
export interface SVGStyleConfiguration {
    readonly color?: string;
    readonly cx?: number;
    readonly cy?: number;
    readonly fill?: string;
    readonly fontColor?: string;
    readonly fontFamily?: string;
    readonly fontSize?: string;
    readonly fontSizeAdjust?: string;
    readonly fontStretch?: string;
    readonly fontVariant?: string;
    readonly fontHeight?: string;
    readonly letterSpacing?: string;
    readonly markerEnd?: string;
    readonly markerStart?: string;
    readonly opacity?: number;
    readonly rx?: number;
    readonly ry?: number;
    readonly shapeRendering?: string;
    readonly stopColor?: string;
    readonly stopOpacity?: string;
    readonly stroke?: string;
    readonly strokeDasharray?: string;
    readonly strokeDashoffset?: string;
    readonly strokeLinecap?: string;
    readonly strokeMiterlimit?: string;
    readonly strokeOpacity?: number;
    readonly textAnchor?: string;
    readonly textDecoration?: string;
    readonly textOverflow?: string;
    readonly textRendering?: string;
    readonly whiteSpace?: string;
    readonly width?: number;
    readonly wordSpacing?: string;
    readonly writingMode?: string;
    readonly x?: string;
    readonly y?: string;
}

/// An SVG style map
export interface SVGStyleMap {
    readonly data?: SVGStyleConfiguration;
    readonly labels?: SVGStyleConfiguration;
}