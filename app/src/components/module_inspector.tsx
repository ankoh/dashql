import * as React from "react";
import { connect } from 'react-redux';
import { AppState, AppStateMutations, Dispatch } from '../store';
import classnames from 'classnames';

import styles from './module_inspector.module.css';

interface Props {
    className?: string
}

class ModuleInspector extends React.Component<Props> {
    public render() {

        return (
            <div className={classnames(this.props.className, styles.inspector)}>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    module: state.editorModule
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({
});

export default connect(mapStateToProps, mapDispatchToProps)(ModuleInspector);
