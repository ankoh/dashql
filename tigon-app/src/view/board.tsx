import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';
import { AutoSizer } from 'react-virtualized';
import './board.scss';

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
};

enum RulerOrientation {
    Horizontal,
    Vertical
}

interface IRulerProps {
    width: number,
    height: number,
    orientation: RulerOrientation,
    scaleFactor: number,

    strokeStyle?: string;
    fillStyle?: string;
    fontSize?: string;
    fontFamily?: string;
    lineWidth?: number;
}

interface Iboardtate {
    ticks: Array<Tick>;
    labels: Array<Label>;
    dpr: number;
}

class Ruler extends React.Component<IRulerProps, Iboardtate> {
    canvas: React.RefObject<HTMLCanvasElement>;

    get strokeStyle(): string { return this.props.strokeStyle || "rgb(200, 200, 200)"; }
    get fillStyle(): string { return this.props.strokeStyle || "rgb(180, 180, 180)"; }
    get fontSize(): string { return this.props.fontSize || "9px"; }
    get fontFamily(): string { return this.props.fontFamily || "Open Sans"; }
    get font(): string { return this.fontSize + ' ' + this.fontFamily; }
    get lineWidth(): number { return this.props.lineWidth || 1; }

    constructor(props: IRulerProps) {
        super(props);
        this.canvas = React.createRef();
        let [ticks, labels] = this.layout();
        this.state = {
            dpr: window.devicePixelRatio,
            ticks: ticks,
            labels: labels,
        }
    }

    layout(): [Array<Tick>, Array<Label>] {
        if (this.props.orientation == RulerOrientation.Horizontal) {
            return this.layoutImpl(this.props.width, this.props.height, this.props.scaleFactor);
        } else {
            return this.layoutImpl(this.props.height, this.props.width, this.props.scaleFactor);
        }
    }

    layoutImpl(length: number, thickness: number, scaleFactor: number): [Array<Tick>, Array<Label>] {
        let ticks = new Array<Tick>();
        let labels = new Array<Label>();
        let stepLength = 5;
        let labelOffset = stepLength;
        for (let tickID = 0; tickID < length / 5; ++tickID) {
            const x = tickID * stepLength;
            if (tickID % 10 === 0) {
                ticks.push(new Tick([x, thickness - 0.5], [x, thickness * 1 / 3 - 0.5]));
                labels.push(new Label([x + labelOffset, thickness / 4 - 0.5], Math.round(x * scaleFactor).toString()))
            } else {
                ticks.push(new Tick([x, thickness - 0.5], [x, thickness * 2 / 3 + 0.5]));
            }
        }

        return [ticks, labels];
    }

    draw(canvas: HTMLCanvasElement) {
        canvas.width = this.props.width * this.state.dpr;
        canvas.height = this.props.height * this.state.dpr;

        let context = canvas.getContext("2d")!;
        context.strokeStyle = this.strokeStyle;
        context.fillStyle = this.fillStyle;
        context.font = this.font;
        context.lineWidth = this.lineWidth;
        context.scale(this.state.dpr, this.state.dpr);

        context.textAlign = "left";
        context.textBaseline = "top";

        if (this.props.orientation == RulerOrientation.Vertical) {
            context.translate(canvas.width / 2, canvas.height / 2);
            context.rotate(Math.PI / 2);
            context.translate(-canvas.width / 2, -canvas.height / 2);
        }

        context.beginPath();

        for (let tick of this.state.ticks) {
            context.moveTo(tick.begin[0], tick.begin[1]);
            context.lineTo(tick.end[0], tick.end[1]);
        }

        for (let label of this.state.labels) {
            context.fillText(label.text, label.position[0], label.position[1]);
        }

        context.stroke();

    }

    componentDidMount() {
        if (this.canvas.current) {
            this.draw(this.canvas.current);
        }
    }

    componentDidUpdate(prevProps: IRulerProps) {
        if (this.props != prevProps) {
            let [ticks, labels] = this.layout();
            this.setState({
                dpr: window.devicePixelRatio,
                ticks: ticks,
                labels: labels,
            });
        } else if (this.canvas.current) {
            this.draw(this.canvas.current);
        }
    }

    render() {
        return (
            <canvas className="board_ruler" ref={this.canvas} />
        );
    }
};

interface IBoardProps {
    scaleFactor: number,
}

export class Board extends React.Component<IBoardProps, {}> {
    constructor(props: IBoardProps) {
        super(props);
    }

    public render() {
        return (
            <div className="board">
                <div className="board_ruler_top">
                    <AutoSizer>
                        {({ height, width }) => (
                            <Ruler
                                width={width}
                                height={height}
                                orientation={RulerOrientation.Horizontal}
                                scaleFactor={this.props.scaleFactor}
                            />
                        )}
                    </AutoSizer>
                </div>
                <div className="board_ruler_left">
                    <AutoSizer>
                        {({ height, width }) => (
                            <Ruler
                                width={width}
                                height={height}
                                orientation={RulerOrientation.Vertical}
                                scaleFactor={this.props.scaleFactor}
                            />
                        )}
                    </AutoSizer>
                </div>
            </div>
        );
    }
}

function mapStateToProps(_state: Model.RootState) {
    return {
    };
}

function mapDispatchToProps(_dispatch: Model.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Board);
