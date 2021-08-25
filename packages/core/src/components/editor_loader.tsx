import * as React from 'react';
import { CenteredRectangleWaveSpinner } from './spinners';

import styles from './editor_loader.module.css';

interface Props {
    className?: string;
    readOnly: boolean;
}

function loadingSpinner(props: Props) {
    return <CenteredRectangleWaveSpinner className={styles.spinner} active={true} />;
}

const Editor = React.lazy(() => import('./editor'));

export const EditorLoader: React.FC<Props> = (props: Props) => (
    <React.Suspense fallback={loadingSpinner(props)}>
        <Editor readOnly={props.readOnly} className={props.className} />
    </React.Suspense>
);
