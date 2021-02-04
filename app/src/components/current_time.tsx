import * as React from 'react';
import classNames from 'classnames';

interface Props {
    refreshRate: number;
    children: (time: Date, updateTime: () => void) => React.ReactNode;
}

interface State {
    currentTime: Date;
}

class CurrentTime extends React.Component<Props, State> {
    protected _timer: any | null;
    protected _updateTime = this.updateTime.bind(this);

    constructor(props: Props) {
        super(props);
        this._timer = null;
        this.state = {
            currentTime: new Date()
        };
    }

    protected updateTime() {
        this.setState({
            currentTime: new Date()
        });
    }

    public componentDidMount() {
        this._timer = setInterval(
            this.updateTime.bind(this),
            this.props.refreshRate
        );
    }

    public componentDidUpdate(_prevProps: Props) {
        if (this._timer) {
            clearInterval(this._timer);
        }
        this._timer = setInterval(
            this.updateTime.bind(this),
            this.props.refreshRate
        );
    }

    public componentWillUnmount() {
        if (this._timer) {
            clearInterval(this._timer);
        }
        this._timer = null;
    }


    public render() {
        return this.props.children(this.state.currentTime, this._updateTime);
    }
}

export function withCurrentTime<
    OUT_PROPS extends { currentTime?: Date, updateCurrentTime: () => void },
    IN_PROPS = Pick<OUT_PROPS, Exclude<keyof OUT_PROPS, 'currentTime' | 'updateCurrentTime'>>
>(Component: React.ComponentType<OUT_PROPS>, refreshRate: number): React.FunctionComponent<IN_PROPS> {
    return (props: IN_PROPS) => {
        return (
            <CurrentTime refreshRate={refreshRate}>
                {(time, update) => <Component {...Object.assign({} as OUT_PROPS, props, { currentTime: time, updateCurrentTime: update})} />}
            </CurrentTime>
        );
    };
}
