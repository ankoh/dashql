import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';
import classNames from 'classnames';

import './navigation_bar.scss';

interface INavigationBarProps {
    rootView: Model.RootView;
    navigateRoot: (view: Model.RootView) => void;
}


interface INavBarTabProps {
    rootView: Model.RootView;
    onViewChanged: (view: Model.RootView) => void;
    tabView: Model.RootView;
}

function NavBarTab(props: INavBarTabProps) {
    const isActive = props.tabView === props.rootView;
    let tabName = "?";
    switch (props.tabView) {
        case Model.RootView.EXPLORER:
            tabName = "Explorer";
            break;
        case Model.RootView.WORKBOOK:
            tabName = "Workbook";
            break;
        case Model.RootView.LIBRARY:
            tabName = "Library";
            break;
    }
    return (
        <div className="navbar_tab_container">
            <div
                className={classNames("navbar_tab", isActive ? " active" : "")}
                onClick={()=>{ props.onViewChanged(props.tabView); }}
            >
                <div className="navbar_tab_name">
                    {tabName}
                </div>
            </div>
        </div>
    );
}

class NavigationBar extends React.Component<INavigationBarProps> {
    public render() {
        return (
            <div className="navbar">
                <div className="navbar_brand">
                    Tigon
                </div>
                <div className="navbar_tabs">
                    <NavBarTab
                        tabView={Model.RootView.EXPLORER}
                        rootView={this.props.rootView}
                        onViewChanged={this.props.navigateRoot}
                    />
                    <NavBarTab
                        tabView={Model.RootView.WORKBOOK}
                        rootView={this.props.rootView}
                        onViewChanged={this.props.navigateRoot}
                    />
                    <NavBarTab
                        tabView={Model.RootView.LIBRARY}
                        rootView={this.props.rootView}
                        onViewChanged={this.props.navigateRoot}
                    />
                </div>
            </div>
        );
    }
}

function mapStateToProps(state: Model.RootState) {
    return {
        rootView: state.rootView
    };
}
function mapDispatchToProps(dispatch: Model.Dispatch) {
    return {
        navigateRoot: (view: Model.RootView) => { dispatch(Model.navigateRoot(view)); },
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(NavigationBar);

