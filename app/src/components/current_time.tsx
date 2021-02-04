import * as React from 'react';
import classNames from 'classnames';

interface Props {
    refreshRate: number;
    children: (date: Date) => React.ReactNode;
}

interface State {
    currentTime: Date;
}

class CurrentTime extends React.Component<Props, State> {
    protected _timer: number | null;

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
        return this.props.children(this.state.currentTime);
    }
}

export function withCurrentTime<
    OUT_PROPS extends { currentTime?: Date },
    IN_PROPS = Pick<OUT_PROPS, Exclude<keyof OUT_PROPS, 'currentTime'>>
>(Component: React.ComponentType<OUT_PROPS>, refreshRate: number): React.FunctionComponent<IN_PROPS> {
    return (props: IN_PROPS) => {
        return (
            <CurrentTime refreshRate={refreshRate}>
                {(time) => <Component {...Object.assign({} as OUT_PROPS, props, { currentTime: time })} />}
            </CurrentTime>
        );
    };
}
