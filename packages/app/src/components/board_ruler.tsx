import * as React from 'react';

import styles from './board_editor.module.css';

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

interface RulerState {
    ticks: Array<Tick>;
    dpr: number;
}

export class Ruler extends React.Component<RulerProps, RulerState> {
    canvas: React.RefObject<HTMLCanvasElement>;

    constructor(props: RulerProps) {
        super(props);
        this.canvas = React.createRef();
        let ticks = this.layout();
        this.state = {
            dpr: global.window?.devicePixelRatio ?? 2,
            ticks: ticks,
        };
    }

    // Layout the ruler
    layout(): Array<Tick> {
        if (this.props.orientation === RulerOrientation.Horizontal) {
            return this.layoutImpl(this.props.width, this.props.height, this.props.scaleFactor);
        } else {
            let ticks = this.layoutImpl(this.props.height, this.props.width, this.props.scaleFactor);
            ticks.forEach(t => t.transpose());
            return ticks;
        }
    }

    // Layout implementation for both, the horizontal and the vertical ruler
    layoutImpl(length: number, thickness: number, scaleFactor: number): Array<Tick> {
        const lb = this.props.containerPadding;
        const ub = length - this.props.containerPadding;
        let ticks = new Array<Tick>();
        let stepLength = ub - lb;
        if (this.props.stepLength) {
            stepLength = this.props.stepLength + this.props.tickMargin;
        } else if (this.props.stepCount) {
            stepLength = (ub - lb - this.props.tickMargin * (this.props.stepCount - 1)) / this.props.stepCount;
        }
        for (let x = lb - this.props.tickMargin / 2.0; x <= ub; x += stepLength) {
            ticks.push(new Tick([x, thickness - 0.5], [x, thickness / 2 - 0.5]));
        }
        return ticks;
    }

    // Draw the ruler
    draw(canvas: HTMLCanvasElement) {
        // Scale the canvas dimensions
        canvas.width = this.props.width * this.state.dpr;
        canvas.height = this.props.height * this.state.dpr;

        // Prepare the 2D context
        let context = canvas.getContext('2d')!;
        context.strokeStyle = TICK_COLOR;
        context.lineWidth = TICK_WIDTH;
        context.scale(this.state.dpr, this.state.dpr);
        context.textBaseline = 'top';

        if (this.props.orientation === RulerOrientation.Horizontal) {
            context.textAlign = 'left';
            context.beginPath();
            this.state.ticks.forEach(t => {
                context.moveTo(t.begin[0], t.begin[1]);
                context.lineTo(t.end[0], t.end[1]);
            });
            context.stroke();
        } else {
            context.textAlign = 'right';
            context.beginPath();
            this.state.ticks.forEach(t => {
                context.moveTo(t.begin[0], t.begin[1]);
                context.lineTo(t.end[0], t.end[1]);
            });
            context.stroke();
        }
    }

    // Draw the ruler after mount
    componentDidMount() {
        if (this.canvas.current) {
            this.draw(this.canvas.current);
        }
    }

    // Draw the ruler after update
    componentDidUpdate(prevProps: RulerProps) {
        if (this.props !== prevProps) {
            let ticks = this.layout();
            this.setState({
                dpr: global.window?.devicePixelRatio ?? 2,
                ticks: ticks,
            });
        } else if (this.canvas.current) {
            this.draw(this.canvas.current);
        }
    }

    render() {
        return (
            <div className={this.props.className}>
                <canvas className={styles.ruler_canvas} ref={this.canvas} />
            </div>
        );
    }
}
