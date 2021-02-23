// Copyright (c) 2020 The DashQL Authors

/// The viz base spec
export interface VizSpec {
    position: VizPosition;
    components: VizComponentSpec[];
}

export interface VizComponentSpec {
    styles: SVGStyleMap;
    data: VizData;
    selectionID: number | null;
}

/// A position
export interface VizPosition {
    row: number;
    column: number;
    width: number;
    height: number;
};

export interface VizData {
    x?: string;
    y?: string;
    y0?: string;
    categories?: string;
};

/// A style configuration
export interface SVGStyleConfiguration {
    color?: string;
    cx?: number;
    cy?: number;
    fill?: string;
    fontColor?: string;
    fontFamily?: string;
    fontSize?: string;
    fontSizeAdjust?: string;
    fontStretch?: string;
    fontVariant?: string;
    fontHeight?: string;
    letterSpacing?: string;
    markerEnd?: string;
    markerStart?: string;
    opacity?: number;
    rx?: number;
    ry?: number;
    shapeRendering?: string;
    stopColor?: string;
    stopOpacity?: string;
    stroke?: string;
    strokeDasharray?: string;
    strokeDashoffset?: string;
    strokeLinecap?: string;
    strokeMiterlimit?: string;
    strokeOpacity?: number;
    textAnchor?: string;
    textDecoration?: string;
    textOverflow?: string;
    textRendering?: string;
    whiteSpace?: string;
    width?: number;
    wordSpacing?: string;
    writingMode?: string;
    x?: string;
    y?: string;
}

/// An SVG style map
export interface SVGStyleMap {
    data?: SVGStyleConfiguration;
    labels?: SVGStyleConfiguration;
}