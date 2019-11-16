import * as React from 'react';
import Explorer from './explorer';
import Launcher from './launcher';
import NavigationBar from './navigation_bar';
import Workbook from './workbook';
import Library from './library';
import * as Model from '../model';
import { connect } from 'react-redux';

import './router.scss';

interface IRouterProps {
    rootView: Model.RootView;
}

class Router extends React.Component<IRouterProps> {
    public render() {
        switch (this.props.rootView) {
            case Model.RootView.LAUNCHER:
                return (
                    <div className="router">
                        <Launcher />
                    </div>
                );
            case Model.RootView.EXPLORER:
                return (
                    <div className="router">
                        <div className="router_background_grid" />
                        <NavigationBar />
                        <div className="router_page_container">
                            <Explorer />
                        </div>
                    </div>
                );
            case Model.RootView.WORKBOOK:
                return (
                    <div className="router">
                        <div className="router_background_grid" />
                        <NavigationBar />
                        <div className="router_page_container">
                            <Workbook />
                        </div>
                    </div>
                );
            case Model.RootView.LIBRARY:
                return (
                    <div className="router">
                        <div className="router_background_grid" />
                        <NavigationBar />
                        <div className="router_page_container">
                            <Library />
                        </div>
                    </div>
                );
            default:
                return <div />;
        }
    }
}

function mapStateToProps(state: Model.RootState) {
    return {
        rootView: state.rootView
    };
}
function mapDispatchToProps(dispatch: Model.Dispatch) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Router);

