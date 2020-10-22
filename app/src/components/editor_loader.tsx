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

const Editor = React.lazy(() => import('./editor'));

export default class EditorLoader extends React.Component {
    public render() {
        return (
            <React.Suspense fallback={loadingSpinner()}>
                <Editor />
            </React.Suspense>
        );
    }
}

