import * as React from 'react';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';


interface Props {
    className?: string;
}

class Gallery extends React.Component<Props> {
    public render() {
        return (
            <div />
        );
    }
}

const mapStateToProps = (state: AppState) => ({
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Gallery);