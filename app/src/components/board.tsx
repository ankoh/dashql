import * as React from 'react';
import { AppReduxStore } from '../model';
import { connect } from 'react-redux';
import { AutoSizer, withAutoSizer } from '../util/autosizer';
import { Scrollbars, positionValues } from 'react-custom-scrollbars';
import BoardLayout from './board_layout';

import styles from './board.module.css';

const TICK_COLOR = 'rgb(180, 180, 180)';
const TICK_WIDTH = 1;
const LABEL_COLOR = 'rgb(140, 140, 140)';
const LABEL_FONT = '9px arial';

// The ruler orientation
enum RulerOrientation {
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

// A label of the ruler
class Label {
    position: [number, number];
    text: string;
    constructor(position: [number, number], text: string) {
        this.position = position;
        this.text = text;
    }
    transpose() {
        this.position = [this.position[1], this.position[0]];
    }
}

interface IRulerProps {
    className?: string;
    width: number;
    height: number;
    orientation: RulerOrientation;
    scaleFactor: number;
}

interface Iboardtate {
    ticks: Array<Tick>;
    labels: Array<Label>;
    dpr: number;
}

class Ruler extends React.Component<IRulerProps, Iboardtate> {
    canvas: React.RefObject<HTMLCanvasElement>;

    constructor(props: IRulerProps) {
        super(props);
        this.canvas = React.createRef();
        let [ticks, labels] = this.layout();
        this.state = {
            dpr: global.window?.devicePixelRatio ?? 2,
            ticks: ticks,
            labels: labels,
        };
    }

    // Layout the ruler
    layout(): [Array<Tick>, Array<Label>] {
        if (this.props.orientation === RulerOrientation.Horizontal) {
            return this.layoutImpl(this.props.width, this.props.height, this.props.scaleFactor);
        } else {
            let [ticks, labels] = this.layoutImpl(this.props.height, this.props.width, this.props.scaleFactor);
            ticks.forEach(t => t.transpose());
            labels.forEach(l => l.transpose());
            return [ticks, labels];
        }
    }

    // Layout implementation for both, the horizontal and the vertical ruler
    layoutImpl(length: number, thickness: number, scaleFactor: number): [Array<Tick>, Array<Label>] {
        let ticks = new Array<Tick>();
        let labels = new Array<Label>();
        let stepLength = 5;
        for (let tickID = 0; tickID < length / 5; ++tickID) {
            const x = tickID * stepLength;
            if (tickID % 10 === 0) {
                ticks.push(new Tick([x, thickness - 0.5], [x, (thickness * 1) / 3 - 0.5]));
                labels.push(new Label([x, thickness / 4 - 0.5], Math.round(x * scaleFactor).toString()));
            } else {
                ticks.push(new Tick([x, thickness - 0.5], [x, (thickness * 2) / 3 + 0.5]));
            }
        }
        return [ticks, labels];
    }

    // Draw the ruler
    draw(canvas: HTMLCanvasElement) {
        const labelAdjustment = 5;

        // Scale the canvas dimensions
        canvas.width = this.props.width * this.state.dpr;
        canvas.height = this.props.height * this.state.dpr;

        // Prepare the 2D context
        let context = canvas.getContext('2d')!;
        context.strokeStyle = TICK_COLOR;
        context.fillStyle = LABEL_COLOR;
        context.font = LABEL_FONT;
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
            this.state.labels.forEach(l => {
                context.fillText(l.text, l.position[0] + labelAdjustment, l.position[1]);
            });
            context.stroke();
        } else {
            context.textAlign = 'right';
            context.beginPath();
            this.state.ticks.forEach(t => {
                context.moveTo(t.begin[0], t.begin[1]);
                context.lineTo(t.end[0], t.end[1]);
            });
            this.state.labels.forEach(l => {
                context.translate(l.position[0], l.position[1]);
                context.rotate(-0.5 * Math.PI);
                context.fillText(l.text, 0 - labelAdjustment, 0);
                context.rotate(0.5 * Math.PI);
                context.translate(-l.position[0], -l.position[1]);
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
    componentDidUpdate(prevProps: IRulerProps) {
        if (this.props !== prevProps) {
            let [ticks, labels] = this.layout();
            this.setState({
                dpr: global.window?.devicePixelRatio ?? 2,
                ticks: ticks,
                labels: labels,
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

interface IBoardProps {
    scaleFactor: number;
}

export class Board extends React.Component<IBoardProps, {}> {
    constructor(props: IBoardProps) {
        super(props);
    }

    public render() {
        return (
            <div className={styles.container}>
                <AutoSizer>
                    {({ height, width }) => (
                        <div className={styles.content_with_rulers}>
                            <div className={styles.ruler_corner} />
                            <Ruler
                                className={styles.ruler_top}
                                width={width - 32}
                                height={32}
                                orientation={RulerOrientation.Horizontal}
                                scaleFactor={this.props.scaleFactor}
                            />
                            <Scrollbars
                                className={styles.content_scroller}
                                width={width}
                                height={height - 32}
                                renderTrackHorizontal={props => (
                                    <div {...props} style={{ display: 'none' }} className="track-horizontal" />
                                )}
                            >
                                <div className={styles.content_container}>
                                    <BoardLayout className={styles.content} width={width - 32} />
                                    <div className={styles.ruler_left}>
                                        <AutoSizer disableWidth>
                                            {s => (
                                                <Ruler
                                                    width={32}
                                                    height={s.height}
                                                    orientation={RulerOrientation.Vertical}
                                                    scaleFactor={this.props.scaleFactor}
                                                />
                                            )}
                                        </AutoSizer>
                                    </div>
                                </div>
                            </Scrollbars>
                        </div>
                    )}
                </AutoSizer>
            </div>
        );
    }
}

function mapStateToProps(_state: AppReduxStore) {
    return {};
}

function mapDispatchToProps(_dispatch: AppReduxStore) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Board);
