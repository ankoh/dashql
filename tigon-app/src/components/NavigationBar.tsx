import * as React from 'react';
import * as Store from '../store';
import TabBar from './TabBar';
import { connect } from 'react-redux';
import { ArrowBackIcon } from '../svg/Icons';
import { isElectron } from '../utils/UserAgent';

import './NavigationBar.css';

interface INavigationBarProps {
    deselectServer: () => void;
    navigateRoot: (view: Store.RootView) => void;
}

class NavigationBar extends React.Component<INavigationBarProps> {
    public render() {
        return (
            <div className="NavigationBar">
                <div
                    className="NavigationBar-Back"
                    onClick={() => this.props.deselectServer()}
                    style={{
                        marginLeft: isElectron() ? '72px' : '0px'
                    }}
                >
                    <ArrowBackIcon width="24px" height="24px" fill="rgb(255, 255, 255)" />
                </div>
                <div className="NavigationBar-Tabs">
                    <TabBar onViewChanged={this.props.navigateRoot} />
                </div>
            </div>
        );
    }
}

function mapStateToProps(state: Store.RootState) {
    return {
    };
}
function mapDispatchToProps(dispatch: Store.Dispatch) {
    return {
        deselectServer: () => { dispatch(Store.deselectServer()); },
        navigateRoot: (view: Store.RootView) => { dispatch(Store.navigateRoot(view)); },
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(NavigationBar);

