import * as Immutable from 'immutable';
import * as React from 'react';
import * as Store from '../store';
import { connect } from 'react-redux';
import { ArrowForwardIosIcon } from '../svg/Icons';
import { PulsingCircleSpinner } from './Spinners';
import { Logo } from '../svg/Logo';
import { isElectron } from '../utils/UserAgent';

import './ServerSelector.css';

interface IServerSelectorProps {
    serverConfigs: Immutable.Seq.Indexed<[string, Store.ServerConfig]>;
    serverInfos: Immutable.Seq.Keyed<string, Store.ServerInfo>;
    selectServer: (key: string) => void;
}

class ServerSelector extends React.Component<IServerSelectorProps> {
    public renderServerEntry(key: string, config: Store.ServerConfig) {
        const serverInfo = this.props.serverInfos.get(key) || new Store.ServerInfo();
        return (
            <div key={key} className="ServerSelector-List-Entry">
                <div className="ServerSelector-List-Entry-Status">
                    <PulsingCircleSpinner
                        key={serverInfo.connectionHeartbeat}
                        counter={serverInfo.connectionHeartbeat}
                    />
                </div>
                <div className="ServerSelector-List-Entry-Hostname">
                    {config.connection.host}
                </div>
                <div className="ServerSelector-List-Entry-Protocol">
                    Proto: {config.protocol}
                </div>
                <div className="ServerSelector-List-Entry-Port">
                    Port: {config.connection.port}
                </div>
                <div className="ServerSelector-List-Entry-Border" />
                <div
                    className="ServerSelector-List-Entry-Arrow"
                    onClick={() => this.props.selectServer(key)}
                >
                    <ArrowForwardIosIcon width="18px" height="18px" fill="rgb(42, 63, 95)" />
                </div>
            </div>
        );
    }

    public render() {
        return (
            <div className="ServerSelector">
                {
                    !isElectron() && 
                    <div>
                        <div className="ServerSelector-Hire-Background" />
                        <div className="ServerSelector-Hire-Text">
                            @TUM ?
                        </div>
                    </div>
                }
                <div className="ServerSelector-Header">
                    <div className="ServerSelector-Header-Logo">
                        <Logo width="100%" height="100%" />
                    </div>
                    <div className="ServerSelector-Header-Name">
                        Umbra Analytics
                    </div>
                </div>
                <div className="ServerSelector-List-Container">
                    <div className="ServerSelector-List-Header">
                        Servers
                    </div>
                    <div className="ServerSelector-List">
                        {
                            this.props.serverConfigs.map((entry) => {
                                // TODO why does immutable.js return undefined when mapping a function?
                                if (!entry) { return <div />; }
                                return this.renderServerEntry(entry[0], entry[1]);
                            })
                        }
                    </div>
                </div>
                <div className="ServerSelector-Version">
                    version: {process.env.REACT_APP_VERSION}
                </div>
            </div>
        );
    }

}

function mapStateToProps(state: Store.RootState) {
    return {
        serverConfigs: state.serverConfigs.entrySeq() as Immutable.Seq.Indexed<[string, Store.ServerConfig]>,
        serverInfos: state.serverInfos.toKeyedSeq(),
    };
}
function mapDispatchToProps(dispatch: Store.Dispatch) {
    return {
        selectServer: (key: string) => dispatch(Store.selectServer(key))
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(ServerSelector);

