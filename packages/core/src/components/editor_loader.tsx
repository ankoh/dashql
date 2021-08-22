import * as React from 'react';
import { RectangleWaveSpinner } from './spinners';
import classnames from 'classnames';

import styles from './editor_loader.module.css';

interface Props {
    className?: string;
    readOnly: boolean;
}

function loadingSpinner(props: Props) {
    return (
        <div className={classnames(styles.editor_loader, props.className)}>
            <RectangleWaveSpinner active={true} />
        </div>
    );
}

const Editor = React.lazy(() => import('./editor'));

export const EditorLoader: React.FC<Props> = (props: Props) => (
    <React.Suspense fallback={loadingSpinner(props)}>
        <Editor readOnly={props.readOnly} className={props.className} />
    </React.Suspense>
);
