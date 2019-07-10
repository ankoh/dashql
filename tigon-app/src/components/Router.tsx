import * as React from 'react';
import DataExplorer from './DataExplorer';
import StatusBar from './StatusBar';
import NavigationBar from './NavigationBar';
import * as Store from '../store';
import { connect } from 'react-redux';

import './Router.css';

interface IRouterProps {
    rootView: Store.RootView;
}

class Router extends React.Component<IRouterProps> {
    public render() {
        switch (this.props.rootView) {
            case Store.RootView.DATA_EXPLORER:
                return (
                    <div className="Router">
                        <NavigationBar />
                        <div className="Router-Page-Container">
                            <div className="Router-Page">
                                <DataExplorer />
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

function mapStateToProps(state: Store.RootState) {
    return {
        rootView: state.rootView
    };
}
function mapDispatchToProps(dispatch: Store.Dispatch) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Router);

