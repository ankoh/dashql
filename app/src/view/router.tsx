import * as React from 'react';
import Explorer from './explorer';
import Launcher from './launcher';
import NavigationBar from './navigation_bar';
import Workbook from './workbook';
import Library from './library';
import * as Store from '../store';
import { connect } from 'react-redux';

import styles from './router.module.scss';

interface IRouterProps {
    rootView: Store.RootView;
}

class Router extends React.Component<IRouterProps> {
    public render() {
        switch (this.props.rootView) {
            case Store.RootView.LAUNCHER:
                return (
                    <div className={styles.router}>
                        <Launcher />
                    </div>
                );
            case Store.RootView.EXPLORER:
                return (
                    <div className={styles.router}>
                        <NavigationBar />
                        <div className={styles.router_page_container}>
                            <Explorer />
                        </div>
                    </div>
                );
            case Store.RootView.WORKBOOK:
                return (
                    <div className={styles.router}>
                        <NavigationBar />
                        <div className={styles.router_page_container}>
                            <Workbook />
                        </div>
                    </div>
                );
            case Store.RootView.LIBRARY:
                return (
                    <div className={styles.router}>
                        <NavigationBar />
                        <div className={styles.router_page_container}>
                            <Library />
                        </div>
                    </div>
                );
            default:
                return <div />;
        }
    }
}

function mapStateToProps(state: Store.RootState) {
    return {
        rootView: state.rootView,
    };
}
function mapDispatchToProps(_dispatch: Store.Dispatch) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Router);
