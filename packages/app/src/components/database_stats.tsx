import * as React from 'react';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { withCurrentTime } from './current_time';

interface Props {
    onClose: () => void;
    currentTime: Date;
    updateCurrentTime: () => void;
}

class DatabaseStats extends React.Component<Props> {
    public render() {
        const height = 200;
        return <SystemCard title="Database" onClose={this.props.onClose} />;
    }

    componentDidMount() {}

    componentDidUpdate(_prev: Readonly<Props>): void {}
}

const mapStateToProps = (state: AppState) => ({});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withCurrentTime(DatabaseStats, 5000));
