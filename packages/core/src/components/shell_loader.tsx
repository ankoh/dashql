import * as React from 'react';
import { RectangleWaveSpinner } from './spinners';
import { clsx } from '../utils';

import styles from './shell_loader.module.css';

interface Props {
    className?: string;
}

function loadingSpinner(props: Props) {
    return (
        <div className={clsx(styles.terminal_loader, props.className)}>
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
