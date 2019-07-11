import './StatusBar.css';
import * as React from 'react';
import * as Store from '../store';
import LogViewer from './LogViewer';
import { connect } from 'react-redux';

import {
    WarningIcon,
} from '../svg/Icons';

const connStatusNames = new Map<Store.ConnectionStatus, string>([
    [Store.ConnectionStatus.CS_CONNECTED, 'connected'],
    [Store.ConnectionStatus.CS_DISCONNECTED, 'disconnected'],
    [Store.ConnectionStatus.CS_UNDEFINED, 'undefined'],
]);

interface IStatusBarProps {
    serverConfig: Store.ServerConfig | null;
    serverInfo: Store.ServerInfo | null;
    logWarnings: number;
}

interface IStatusBarState {
    logsOpen: boolean;
}

export class StatusBar extends React.Component<IStatusBarProps, IStatusBarState> {
    constructor(props: IStatusBarProps) {
        super(props);
        this.state = {
            logsOpen: false
        };
        this.toggleLogViewer = this.toggleLogViewer.bind(this);
    }

    public render() {
        let connStatus = Store.ConnectionStatus.CS_UNDEFINED;
        let url = '-';
        let version = '-';
        if (this.props.serverInfo) {
            connStatus = this.props.serverInfo.connectionStatus;
            version = this.props.serverInfo.version;
        }

        return (
            <div className="StatusBar">
                <div className="StatusBar-Left">
                    {
                        this.props.serverConfig &&
                        <div className="StatusBar-Server">
                            <span className="StatusBar-Server-Name">
                                server:&nbsp;<b>{url}</b>
                            </span>
                            <span className="StatusBar-Server-Status">
                                status:&nbsp;<b>{connStatusNames.get(connStatus) || '-'}</b>
                            </span>
                            <span className="StatusBar-Server-Version">
                                version:&nbsp;<b>{version}</b>
                            </span>
                        </div>
                    }
                </div>
                <div
                    className={'StatusBar-LogStats' + (this.state.logsOpen ? ' StatusBar-LogStats-Active' : '')}
                    onClick={this.toggleLogViewer}
                >
                    <div className="StatusBar-LogStat">
                        <div className="StatusBar-LogStat-Icon">
                            <WarningIcon width="13px" height="13px" />
                        </div>
                        <div className="StatusBar-LogStat-Name">
                            warnings: <b>{this.props.logWarnings}</b>
                        </div>
                    </div>
                </div>
                {
                    this.state.logsOpen && (
                    <div className="StatusBar-LogViewer">
                        <LogViewer close={this.toggleLogViewer} />
                    </div>
                    )
                }
            </div>
        );
    }

    protected toggleLogViewer() {
        this.setState((s) => ({ ...s, logsOpen: !s.logsOpen }));
    }
}

// Map state to props
function mapStateToProps(state: Store.RootState) {
    const serverConfig = (state.selectedServer && state.serverConfigs.get(state.selectedServer)) || null;
    const serverInfo = (state.selectedServer && state.serverInfos.get(state.selectedServer)) || null;
    return {
        logWarnings: state.logWarnings,
        serverConfig,
        serverInfo,
    };
}
// Map llvm explorer dispatchs
function mapDispatchToProps(dispatch: Store.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(StatusBar);
