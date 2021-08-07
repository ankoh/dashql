import * as React from 'react';
import { RectangleWaveSpinner } from './spinners';
import classnames from 'classnames';

import styles from './terminal_loader.module.css';

interface Props {
    className?: string;
}

function loadingSpinner(props: Props) {
    return (
        <div className={classnames(styles.terminal_loader, props.className)}>
            <RectangleWaveSpinner active={true} />
        </div>
    );
}

const Terminal = React.lazy(() => import('./terminal'));

export const TerminalLoader: React.FC<Props> = (props: Props) => (
    <React.Suspense fallback={loadingSpinner(props)}>
        <Terminal {...props} />
    </React.Suspense>
);
