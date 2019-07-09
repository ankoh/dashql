import * as React from 'react';
import * as Store from '../store';
import { connect } from 'react-redux';

import './VizCompositor.css';

class VizCompositor extends React.Component<{}> {
    public render() {
        return (
            <div className="VizCompositor" />
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

export default connect(mapStateToProps, mapDispatchToProps)(VizCompositor);

