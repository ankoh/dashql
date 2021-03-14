import * as React from 'react';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';

import styles from './explorer.module.css';

interface Props {
    className?: string;
}

class Explorer extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.explorer}>
                
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Explorer);