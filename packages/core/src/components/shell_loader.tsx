import * as React from 'react';
import { RectangleWaveSpinner } from './spinners';
import classnames from 'classnames';

import styles from './shell_loader.module.css';

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

const Shell = React.lazy(() => import('./shell'));

export const ShellLoader: React.FC<Props> = (props: Props) => (
    <React.Suspense fallback={loadingSpinner(props)}>
        <Shell {...props} />
    </React.Suspense>
);
