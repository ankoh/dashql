import * as React from 'react';
import * as Store from '../store';
import { connect } from 'react-redux';

import './Console.css';

interface IConsoleProps {
    navigateRoot: (view: Store.RootView) => void;
}

class Console extends React.Component<IConsoleProps> {
    public render() {
        return (
            <div className="Console">
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
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(Console);

