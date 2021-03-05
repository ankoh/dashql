// Copyright (c) 2020 The DashQL Authors

import { proto } from 'src/index_node';
import { PlanObject } from './plan_object';

/// The viz base spec
export interface VizInfo extends PlanObject {
    readonly currentStatementId: number;
    readonly position: VizPosition;
    readonly title?: string;
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
}

export interface VizData {
    readonly x?: string[];
    readonly y?: string[];
    readonly group?: string[];
    readonly stack?: string[];
    readonly order?: string[];
    readonly samples?: number;
}

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
    readonly axis?: SVGStyleConfiguration;
    readonly axisLabel?: SVGStyleConfiguration;
    readonly data?: SVGStyleConfiguration;
    readonly grid?: SVGStyleConfiguration;
    readonly labels?: SVGStyleConfiguration;
    readonly max?: SVGStyleConfiguration,
    readonly maxLabels?: SVGStyleConfiguration,
    readonly median?: SVGStyleConfiguration,
    readonly medianLabels?: SVGStyleConfiguration,
    readonly min?: SVGStyleConfiguration,
    readonly minLabels?: SVGStyleConfiguration,
    readonly q1?: SVGStyleConfiguration,
    readonly q1Labels?: SVGStyleConfiguration,
    readonly q3?: SVGStyleConfiguration,
    readonly q3Labels?: SVGStyleConfiguration
    readonly tickLabels?: SVGStyleConfiguration;
    readonly ticks?: SVGStyleConfiguration;
}
