import * as React from 'react';
import * as Store from '../store';
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

function mapStateToProps(_state: Store.RootState) {
    return {
    };
}

function mapDispatchToProps(_dispatch: Store.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Library);
