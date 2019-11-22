import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';

interface ILibraryProps {
}

interface ILibraryState {
}

export class Library extends React.Component<ILibraryProps, ILibraryState> {
    public render() {
        return (
            <div />
        );
    }
}

function mapStateToProps(_state: Model.RootState) {
    return {
    };
}

function mapDispatchToProps(_dispatch: Model.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Library);
