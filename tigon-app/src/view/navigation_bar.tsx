import * as React from 'react';
import * as Model from '../model';
import TabBar from './tab_bar';
import { Logo } from '../svg/logo'
import { connect } from 'react-redux';

import './navigation_bar.css';

interface INavigationBarProps {
    navigateRoot: (view: Model.RootView) => void;
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

function mapStateToProps(state: Model.RootState) {
    return {
    };
}
function mapDispatchToProps(dispatch: Model.Dispatch) {
    return {
        navigateRoot: (view: Model.RootView) => { dispatch(Model.navigateRoot(view)); },
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(NavigationBar);

