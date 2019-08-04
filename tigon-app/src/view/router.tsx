import * as React from 'react';
import Explorer from './explorer';
import NavigationBar from './navigation_bar';
import StatusBar from './status_bar';
import * as Model from '../model';
import { connect } from 'react-redux';

import './router.css';

interface IRouterProps {
    rootView: Model.RootView;
}

class Router extends React.Component<IRouterProps> {
    public render() {
        switch (this.props.rootView) {
            case Model.RootView.EXPLORER:
                return (
                    <div className="router">
                        <NavigationBar />
                        <div className="router-page-container">
                            <div className="router-page">
                                <Explorer />
                            </div>
                        </div>
                        <StatusBar />
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

