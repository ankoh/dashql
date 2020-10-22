import * as Loadable from 'react-loadable';
import * as React from 'react';
import { RectangleWaveSpinner } from './spinners';

import styles from './editor_loader.module.css';

function loadingSpinner() {
    return (
        <div className={styles.editor_loader}>
            <RectangleWaveSpinner active={true} />
        </div>
    );
}

const Loader = Loadable({
    loader: () => import('./editor'),
    loading: loadingSpinner
});

export default class EditorLoader extends React.Component {
    public render() {
        return <Loader />;
    }
}

