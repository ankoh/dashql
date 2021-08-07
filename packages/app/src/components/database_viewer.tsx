import * as React from 'react';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { withCurrentTime } from './current_time';
import { TerminalLoader } from './terminal_loader';

interface Props {
    className?: string;
    onClose: () => void;
    currentTime: Date;
    updateCurrentTime: () => void;
}

class DatabaseViewer extends React.Component<Props> {
    public render(): React.ReactElement {
        return (
            <SystemCard title="Database" onClose={this.props.onClose} className={this.props.className}>
                <TerminalLoader />
            </SystemCard>
        );
    }

    componentDidMount() {}

    componentDidUpdate(_prev: Readonly<Props>): void {}
}

const mapStateToProps = (state: AppState) => ({});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withCurrentTime(DatabaseViewer, 5000));
