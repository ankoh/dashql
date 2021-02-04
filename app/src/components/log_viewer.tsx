import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import { proto } from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { withCurrentTime } from './current_time';
import { ActionStatusIndicator } from './status';
import { ChevronRightIcon, CloseIcon } from '../svg/icons';
import { List, ListRowProps, AutoSizer } from 'react-virtualized';
import styles from './log_viewer.module.css';

const OVERSCAN_ROW_COUNT = 5;

interface LogRowProps {
    entry: core.model.LogEntryVariant;
}

function LogRow(props: LogRowProps) {
    return (
        <div>
        </div>
    );
}

interface Props {
    className?: string;
    logs: Immutable.List<core.model.LogEntryVariant>;
    currentTime: Date;
    onClose: () => void;
}

class LogViewer extends React.Component<Props> {
    protected _getRowHeight = this.getRowHeight.bind(this);
    protected _renderRow = this.renderRow.bind(this);
    protected _renderEmptyList = this.renderEmptyList.bind(this);

    protected getRowHeight(args: {index: number}) {
        return 42;
    }

    protected renderRow(props: ListRowProps) {
        const log = this.props.logs.get(props.index);
        if (!log) return <div />;

        const tsNow = this.props.currentTime;
        const tsLog = log.timestamp;
        return (
            <div key={props.index} style={props.style}>
                {core.utils.getRelativeTime(tsLog, tsNow)}
            </div>
        );
    }

    protected renderEmptyList() {
        return <div />;
    }

    public render() {
        const height = 200;
        return (
            <SystemCard title="Log" subtitle="Foo" onClose={this.props.onClose}>
                <AutoSizer disableHeight>
                    {({width}) => (
                        <List
                            currentTimeRef={this.props.currentTime}
                            height={200}
                            width={width}
                            overscanRowCount={OVERSCAN_ROW_COUNT}
                            rowCount={this.props.logs.size}
                            rowHeight={this._getRowHeight}
                            rowRenderer={this._renderRow}
                            noRowsRenderer={this._renderEmptyList}
                        />
                    )}
                </AutoSizer>
            </SystemCard>
        );
    }

    componentDidMount() {}

    componentDidUpdate(_prev: Readonly<Props>): void {}
}

const mapStateToProps = (state: AppState) => ({
    logs: state.core.logEntries,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withCurrentTime(LogViewer, 5000));
