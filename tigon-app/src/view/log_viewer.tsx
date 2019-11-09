import './log_viewer.css';
import * as Immutable from 'immutable';
import * as React from 'react';
import * as Model from '../model';
import Scrollbar from 'react-custom-scrollbars';
import { CloseIcon } from '../svg/icons';
import { connect } from 'react-redux';

const levelNames = new Map<Model.LogLevel, string>([
    [Model.LogLevel.UNDEFINED, 'UNDEFINED'],
    [Model.LogLevel.DEBUG, 'DEBUG'],
    [Model.LogLevel.INFO, 'INFO'],
    [Model.LogLevel.WARNING, 'WARNING'],
    [Model.LogLevel.ERROR, 'ERROR'],
]);

function dts(date: Date) {
    return (('0' + date.getHours()).slice(-2) +
        ':' + ('0' + date.getMinutes()).slice(-2) +
        ':' + ('0' + date.getSeconds()).slice(-2));
}

interface ILogViewerProps {
    logs: Immutable.List<Model.LogEntry>;
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
function mapStateToProps(state: Model.RootState) {
    return {
        logs: state.logs
    };
}
// Map log viewer dispatchs
function mapDispatchToProps(dispatch: Model.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(LogViewer);
