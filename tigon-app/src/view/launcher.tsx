import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';

import './launcher.scss';

interface ILauncherProps {
    progress: Model.LaunchProgress;
}

class Launcher extends React.Component<ILauncherProps> {
    public render() {
        return (
            <div className="launcher">
                <div className="launcher_container">
                    <div className="launcher_logo">
                        <img src="/img/logo_600.png" alt="Logo" />
                    </div>
                </div>
            </div>
        );
    }
}

function mapStateToProps(state: Model.RootState) {
    return {
        progress: state.launchProgress
    };
}
function mapDispatchToProps(dispatch: Model.Dispatch) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Launcher);
