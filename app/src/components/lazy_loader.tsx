import * as React from 'react';
import { CenteredRectangleWaveSpinner } from './spinners';

import styles from './lazy_loader.module.css';

type Props = {
    className?: string;
    children: React.ReactElement;
};

function loadingSpinner(props: Props) {
    return <CenteredRectangleWaveSpinner className={styles.spinner} active={true} />;
}

export const LazyLoader: React.FC<Props> = (props: Props) => (
    <React.Suspense fallback={loadingSpinner(props)}>{props.children}</React.Suspense>
);
