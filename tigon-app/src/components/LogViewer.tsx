import './LogViewer.css';
import * as Immutable from 'immutable';
import * as React from 'react';
import * as store from '../store';
import Scrollbar from 'react-custom-scrollbars';
import { CloseIcon } from '../svg/Icons';
import { connect } from 'react-redux';

const levelNames = new Map<store.LogLevel, string>([
    [store.LogLevel.LL_UNDEFINED, 'UNDEFINED'],
    [store.LogLevel.LL_DEBUG, 'DEBUG'],
    [store.LogLevel.LL_INFO, 'INFO'],
    [store.LogLevel.LL_WARNING, 'WARNING'],
    [store.LogLevel.LL_ERROR, 'ERROR'],
]);

function dts(date: Date) {
    return (('0' + date.getHours()).slice(-2) +
        ':' + ('0' + date.getMinutes()).slice(-2) +
        ':' + ('0' + date.getSeconds()).slice(-2));
}

interface ILogViewerProps {
    logs: Immutable.List<store.LogEntry>;
    close: () => void;
}

export class LogViewer extends React.PureComponent<ILogViewerProps> {
    public render() {
        return (
            <div className="LogViewer">
                <div className="LogViewer-Header">
                    <div className="LogViewer-Title">Logs</div>
                    <div
                        className="LogViewer-Close"
                        onClick={(e) => this.props.close()}
                    >
                        <CloseIcon width="16px" height="16px"/>
                    </div>
                </div>
                <Scrollbar className="LogViewer-Entries-Scroller">
                    <div className="LogViewer-Entries">
                    {
                        this.props.logs.map((log, i) => {
                            return (
                                <div key={i} className="LogViewer-Entry">
                                    <div className="LogViewer-Entry-Timestamp">
                                        {dts(log!.timestamp)}
                                    </div>
                                    <div className="LogViewer-Entry-LogLevel">
                                        {levelNames.get(log!.level)}
                                    </div>
                                    <div className="LogViewer-Entry-Text">
                                        {log!.text}
                                    </div>
                                </div>
                            );
                        })
                    }
                    </div>
                </Scrollbar>
            </div>
        );
    }
}

// Map state to props
function mapStateToProps(state: store.RootState) {
    return {
        logs: state.logs
    };
}
// Map log viewer dispatchs
function mapDispatchToProps(dispatch: store.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(LogViewer);
