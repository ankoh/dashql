import * as React from 'react';
import * as Store from '../store';
import { connect } from 'react-redux';
import classNames from 'classnames';

import s from './navigation_bar.module.scss';

interface INavigationBarProps {
    rootView: Store.RootView;
    navigateRoot: (view: Store.RootView) => void;
}

interface INavBarTabProps {
    rootView: Store.RootView;
    onViewChanged: (view: Store.RootView) => void;
    tabView: Store.RootView;
}

function NavBarTab(props: INavBarTabProps) {
    const isActive = props.tabView === props.rootView;
    let tabName = '?';
    switch (props.tabView) {
        case Store.RootView.EXPLORER:
            tabName = 'Explorer';
            break;
        case Store.RootView.WORKBOOK:
            tabName = 'Workbook';
            break;
        case Store.RootView.LIBRARY:
            tabName = 'Library';
            break;
    }
    return (
        <div className={s.tab_container}>
            <div
                className={classNames(s.tab, isActive ? s.active : '')}
                onClick={() => {
                    props.onViewChanged(props.tabView);
                }}
            >
                <div className={s.tab_name}>{tabName}</div>
            </div>
        </div>
    );
}

class NavigationBar extends React.Component<INavigationBarProps> {
    public render() {
        return (
            <div className={s.container}>
                <div className={s.brand}>TIGON</div>
                <div className={s.tabs}>
                    <NavBarTab
                        tabView={Store.RootView.EXPLORER}
                        rootView={this.props.rootView}
                        onViewChanged={this.props.navigateRoot}
                    />
                    <NavBarTab
                        tabView={Store.RootView.WORKBOOK}
                        rootView={this.props.rootView}
                        onViewChanged={this.props.navigateRoot}
                    />
                    <NavBarTab
                        tabView={Store.RootView.LIBRARY}
                        rootView={this.props.rootView}
                        onViewChanged={this.props.navigateRoot}
                    />
                </div>
            </div>
        );
    }
}

function mapStateToProps(state: Store.RootState) {
    return {
        rootView: state.rootView,
    };
}
function mapDispatchToProps(dispatch: Store.Dispatch) {
    return {
        navigateRoot: (view: Store.RootView) => {
            dispatch(Store.navigateRoot(view));
        },
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(NavigationBar);
