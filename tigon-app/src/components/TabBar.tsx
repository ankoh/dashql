import './TabBar.css';
import * as React from 'react';
import * as Store from '../store';
import { connect } from 'react-redux';
import classNames from 'classnames';
import {
    TableChartIcon
} from '../svg/Icons';

interface ITabBarProps {
    rootView: Store.RootView;
    onViewChanged: (view: Store.RootView) => void;
}

interface ITabBarTabProps {
    rootView: Store.RootView;
    onViewChanged: (view: Store.RootView) => void;
    tabView: Store.RootView;
}

function TabBarTab(props: ITabBarTabProps) {
    const isActive = props.tabView === props.rootView;
    let tabName = "?";
    switch (props.tabView) {
        case Store.RootView.DATA_EXPLORER:
            tabName = "Explorer";
            break;
    }
    return (
        <div
            className={classNames("TabBar-Tab", isActive ? "TabBar-Tab-Active" : "")}
            onClick={()=>{ props.onViewChanged(props.tabView); }}
        >
            <div className="TabBar-Tab-Name">
                {tabName}
            </div>
        </div>
    );
}

class TabBar extends React.Component<ITabBarProps> {
    public render() {
        return (
            <div className="TabBar">
                <TabBarTab
                    tabView={Store.RootView.DATA_EXPLORER}
                    rootView={this.props.rootView}
                    onViewChanged={this.props.onViewChanged}
                />
            </div>
        );
    }
}

function mapStateToProps(state: Store.RootState) {
    return {
        rootView: state.rootView
    };
}

function mapDispatchToProps(dispatch: Store.Dispatch) {
    return {
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(TabBar);

