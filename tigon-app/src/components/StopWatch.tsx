import * as React from 'react';
import * as Store from '../store';
import { connect } from 'react-redux';
import { formatDurationMS } from '../utils/Time';

interface IStopWatchProps {
    running: boolean;
    start: number;
    duration: number;
}

interface IStopWatchState {
    elapsed: number;
}

const timerInterval = 31;

class StopWatch extends React.Component<IStopWatchProps, IStopWatchState> {
    protected timer: number | null;

    constructor(props: IStopWatchProps) {
        super(props);
        this.timer = null;
        this.state = {
            elapsed: props.running ? (Date.now() - props.start) : props.duration,
        };
    }

    public componentDidMount() {
        if (this.props.running) {
            this.timer = window.setInterval(() => {
                this.setState({ elapsed: Date.now() - this.props.start });
            }, timerInterval);
        }
    }

    public componentDidUpdate(prevProps: IStopWatchProps) {
        // Is running?
        if (this.props.running) {
            // Was not running?
            if (!prevProps.running) {
                this.timer = window.setInterval(() => {
                    this.setState({ elapsed: Date.now() - this.props.start });
                }, timerInterval);
            }
            return;
        }

        // Clear timer
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // Duration was updated?
        if (prevProps.duration !== this.props.duration) {
            this.setState({ elapsed: this.props.duration });
        }
    }

    public componentWillUnmount() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    public renderDuration(d: number) {
        const m = ("00" + Math.floor(d / 60 / 1000)).slice(-2);
        const s = ("00" + Math.floor(d / 1000)).slice(-2);
        const ms = ("000" + Math.floor(d)).slice(-3);
        return `${m}:${s}.${ms}`
    }

    public render() {
        return (
            <div className="StopWatch">
                {formatDurationMS(this.state.elapsed)}
            </div>
        );
    }
}

function mapStateToProps(state: Store.RootState) {
    return {
    };
}

function mapDispatchToProps(dispatch: Store.Dispatch) {
    return {
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(StopWatch);

