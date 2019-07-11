import './tab_bar.css';
import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';
import classNames from 'classnames';

interface ITabBarProps {
    rootView: Model.RootView;
    onViewChanged: (view: Model.RootView) => void;
}

interface ITabBarTabProps {
    rootView: Model.RootView;
    onViewChanged: (view: Model.RootView) => void;
    tabView: Model.RootView;
}

function TabBarTab(props: ITabBarTabProps) {
    const isActive = props.tabView === props.rootView;
    let tabName = "?";
    switch (props.tabView) {
        case Model.RootView.DATA_MODEL:
            tabName = "Data Model";
            break;
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
        <div className="TabBar-Tab-Container">
            <div
                className={classNames("TabBar-Tab", isActive ? "TabBar-Tab-Active" : "")}
                onClick={()=>{ props.onViewChanged(props.tabView); }}
            >
                <div className="TabBar-Tab-Name">
                    {tabName}
                </div>
            </div>
        </div>
    );
}

class TabBar extends React.Component<ITabBarProps> {
    public render() {
        return (
            <div className="TabBar">
                <TabBarTab
                    tabView={Model.RootView.DATA_MODEL}
                    rootView={this.props.rootView}
                    onViewChanged={this.props.onViewChanged}
                />
                <TabBarTab
                    tabView={Model.RootView.EXPLORER}
                    rootView={this.props.rootView}
                    onViewChanged={this.props.onViewChanged}
                />
                <TabBarTab
                    tabView={Model.RootView.WORKBOOK}
                    rootView={this.props.rootView}
                    onViewChanged={this.props.onViewChanged}
                />
                <TabBarTab
                    tabView={Model.RootView.LIBRARY}
                    rootView={this.props.rootView}
                    onViewChanged={this.props.onViewChanged}
                />
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
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(TabBar);

