import * as React from 'react';

const CORNER_COLOR = 'rgb(245, 245, 245)';
const TICK_COLOR = 'rgb(180, 180, 180)';
const TICK_WIDTH = 1;

// The ruler orientation
export enum RulerOrientation {
    Horizontal,
    Vertical,
}

// A tick of the ruler
class Tick {
    begin: [number, number];
    end: [number, number];
    constructor(begin: [number, number], end: [number, number]) {
        this.begin = begin;
        this.end = end;
    }
    transpose() {
        this.begin = [this.begin[1], this.begin[0]];
        this.end = [this.end[1], this.end[0]];
    }
}

interface RulerProps {
    className?: string;
    orientation: RulerOrientation;
    width: number;
    height: number;
    scaleFactor: number;
    containerPadding: number;
    tickMargin: number;
    stepLength?: number;
    stepCount?: number;
}

export const Ruler: React.FC<RulerProps> = (props: RulerProps) => {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const dpr = React.useMemo(() => global.window?.devicePixelRatio ?? 2, []);

    // Helper to compute the layout
    const computeLayout = (length: number, thickness: number, _scaleFactor: number): Array<Tick> => {
        const lb = props.containerPadding;
        const ub = length - props.containerPadding;
        const ticks = new Array<Tick>();
        let stepLength = ub - lb;
        if (props.stepCount !== undefined) {
            stepLength = (ub - lb) / props.stepCount;
        } else if (props.stepLength !== undefined) {
            stepLength = props.stepLength + props.tickMargin;
        }
        const cnt = Math.ceil((ub - lb) / stepLength);
        let x = lb + stepLength;
        for (let i = 1; i < cnt; ++i, x += stepLength) {
            ticks.push(new Tick([x, thickness - 0.5], [x, thickness / 2 - 0.5]));
        }
        return ticks;
    };

    // Compute the ticks
    const ticks = React.useMemo(() => {
        if (props.orientation === RulerOrientation.Horizontal) {
            return computeLayout(props.width, props.height, props.scaleFactor);
        } else {
            const newTicks = computeLayout(props.height, props.width, props.scaleFactor);
            newTicks.forEach(t => t.transpose());
            return newTicks;
        }
    }, [props.orientation, props.width, props.height, props.scaleFactor]);

    // Draw the ruler
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Scale the canvas dimensions
        canvas.width = props.width * dpr;
        canvas.height = props.height * dpr;

        // Prepare the 2D context
        const context = canvas.getContext('2d')!;
        context.strokeStyle = TICK_COLOR;
        context.lineWidth = TICK_WIDTH;
        context.fillStyle = CORNER_COLOR;
        context.scale(dpr, dpr);
        context.textBaseline = 'top';

        if (props.orientation === RulerOrientation.Horizontal) {
            context.beginPath();
            ticks.forEach(t => {
                context.moveTo(t.begin[0], t.begin[1]);
                context.lineTo(t.end[0], t.end[1]);
            });
            context.stroke();

            context.beginPath();
            context.rect(0, 0, props.containerPadding, props.height);
            context.rect(props.width - props.containerPadding, 0, props.containerPadding, props.height);
            context.fill();

            context.beginPath();
            context.moveTo(props.containerPadding, 0);
            context.lineTo(props.containerPadding, props.height - 1);
            context.stroke();

            context.beginPath();
            context.moveTo(props.width - props.containerPadding, 0);
            context.lineTo(props.width - props.containerPadding, props.height - 1);
            context.stroke();
        } else {
            context.beginPath();
            ticks.forEach(t => {
                context.moveTo(t.begin[0], t.begin[1]);
                context.lineTo(t.end[0], t.end[1]);
            });
            context.stroke();

            context.beginPath();
            context.rect(0, 0, props.width - 1, props.containerPadding);
            context.rect(0, props.height - props.containerPadding, props.width - 1, props.containerPadding);
            context.fill();

            context.beginPath();
            context.moveTo(0, props.containerPadding);
            context.lineTo(props.width, props.containerPadding);
            context.stroke();

            context.beginPath();
            context.moveTo(0, props.height - props.containerPadding);
            context.lineTo(props.width, props.height - props.containerPadding);
            context.stroke();
        }
    }, [canvasRef, props.width, props.height, props.containerPadding, props.orientation]);

    return (
        <canvas
            className={props.className}
            ref={canvasRef}
            style={{
                width: props.width,
                height: props.height,
            }}
        />
    );
};
