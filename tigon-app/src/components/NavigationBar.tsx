import * as React from 'react';
import * as Store from '../store';
import TabBar from './TabBar';
import { Logo } from '../svg/Logo'
import { connect } from 'react-redux';

import './NavigationBar.css';

interface INavigationBarProps {
    navigateRoot: (view: Store.RootView) => void;
}

class NavigationBar extends React.Component<INavigationBarProps> {
    public render() {
        return (
            <div className="NavigationBar">
                <div className="NavigationBar-Logo">
                    <Logo />
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
        navigateRoot: (view: Store.RootView) => { dispatch(Store.navigateRoot(view)); },
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(NavigationBar);

