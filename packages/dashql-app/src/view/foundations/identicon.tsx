import * as React from 'react';

enum ShapeType {
    Rectangle = 0,
    RectangleFilled = 1,
    Ellipse = 2,
    EllipseFilled = 3,
    Polygon = 4,
    PolygonFilled = 5,
    Line = 6,
    MAX = 6,
}

function Shape(props: { shape: ShapeType, fill: string }): React.ReactElement {
    switch (props.shape) {
        case ShapeType.RectangleFilled:
            return <path d="M0 0h100v100H0V0Z" fill={props.fill} />;
        case ShapeType.Rectangle:
            return (
                <path
                    d="M90 10H10v80h80V10ZM0 0v100h100V0H0Z"
                    fill={props.fill}
                    fillRule="evenodd"
                    clipRule="evenodd"
                />
            );
        case ShapeType.EllipseFilled:
            return <path d="M100 50A50 50 0 1 1 0 50a50 50 0 0 1 100 0Z" fill={props.fill} />;
        case ShapeType.Ellipse:
            return (
                <path
                    d="M50 90a40 40 0 1 0 0-80 40 40 0 0 0 0 80Zm0 10A50 50 0 1 0 50 0a50 50 0 0 0 0 100Z"
                    fill={props.fill}
                    fillRule="evenodd"
                    clipRule="evenodd"
                />
            );
        case ShapeType.PolygonFilled:
            return <path d="m50 7 50 86.6H0L50 7Z" fill={props.fill} />;
        case ShapeType.Polygon:
            return (
                <path
                    d="M50 7 0 93.6h100L50 7Zm0 20L17.3 83.6h65.4L50 27Z"
                    fill={props.fill}
                    fillRule="evenodd"
                    clipRule="evenodd"
                />
            );
        case ShapeType.Line:
            return <path d="M45-150h10v400H45z" fill={props.fill} />;

    }
}

interface ComponentProps {
    width: number;
    height: number;
    shapes: ShapeType[];
    fills: string[];
    offsetXMin: number;
    offsetXMax: number;
    offsetYMin: number;
    offsetYMax: number;
    rotateMin: number;
    rotateMax: number;
    value: number;
}

function Component(props: ComponentProps) {
    const shape: ShapeType = props.shapes[Math.floor(props.value * props.shapes.length)];
    const fill: string = props.fills[Math.floor(props.value * props.fills.length)];
    const offsetX = props.offsetXMin + Math.round(props.value * (props.offsetXMax - props.offsetXMin));
    const offsetY = props.offsetYMin + Math.round(props.value * (props.offsetYMax - props.offsetYMin));
    const rotate = props.rotateMin + Math.round(props.value * (props.rotateMax - props.rotateMin));
    return (
        <g transform={`translate(${offsetX}, ${offsetY}) rotate(${rotate} ${props.width / 2} ${props.height / 2})`}>
            {<Shape shape={shape} fill={fill} />}
        </g>
    );
}

// const SHAPE_FILLS: string[] = [
//     "#363d45",
//     "#3d7789",
//     "#38b8b7",
//     "#79fac5",
// ];

const SHAPE_FILLS: string[] = [
    "hsl(210deg, 12%, 36%)",
    "hsl(210deg, 12%, 46%)",
    "hsl(210deg, 12%, 56%)",
    "hsl(210deg, 12%, 66%)",
];

export interface IdenticonProps {
    style?: React.CSSProperties;
    className?: string;
    width?: number;
    height?: number;
    layers: number[];
}

export function Identicon(props: IdenticonProps) {
    return (
        <svg
            className={props.className}
            style={props.style}
            width={props.width ? `${props.width}px` : "100%"}
            height={props.height ? `${props.height}px` : "100%"}
            viewBox="0 0 100 100"
        >
            {(props.layers.length >= 1) && (
                <g transform="matrix(1.2 0 0 1.2 -10 -10)">
                    <Component
                        value={props.layers[0]}
                        width={100}
                        height={100}
                        shapes={[
                            ShapeType.RectangleFilled,
                            ShapeType.EllipseFilled,
                            ShapeType.PolygonFilled
                        ]}
                        fills={[
                            "hsl(210deg, 12%, 36%)"
                        ]}
                        offsetXMin={-65}
                        offsetXMax={65}
                        offsetYMin={-45}
                        offsetYMax={45}
                        rotateMin={-160}
                        rotateMax={160}

                    />
                </g>
            )}
            {(props.layers.length >= 2) && (
                <g transform="matrix(.8 0 0 .8 10 10)">
                    <Component
                        value={props.layers[1]}
                        width={100}
                        height={100}
                        shapes={[
                            ShapeType.RectangleFilled,
                            ShapeType.EllipseFilled,
                            ShapeType.PolygonFilled,
                        ]}
                        fills={[
                            "hsl(210deg, 12%, 56%)"
                        ]}
                        offsetXMin={-40}
                        offsetXMax={40}
                        offsetYMin={-40}
                        offsetYMax={40}
                        rotateMin={-180}
                        rotateMax={180}
                    />
                </g>
            )}
            {(props.layers.length >= 3) && (
                <g transform="matrix(.4 0 0 .4 30 30)">
                    <Component
                        value={props.layers[2]}
                        width={100}
                        height={100}
                        shapes={[
                            ShapeType.Rectangle,
                            ShapeType.Ellipse,
                            ShapeType.Polygon,
                            ShapeType.Line,
                        ]}
                        fills={[
                            "hsl(210deg, 12%, 46%)",
                            "hsl(210deg, 12%, 66%)",
                        ]}
                        offsetXMin={-40}
                        offsetXMax={40}
                        offsetYMin={-40}
                        offsetYMax={40}
                        rotateMin={-180}
                        rotateMax={180}
                    />
                </g>
            )}
        </svg>
    );
}
