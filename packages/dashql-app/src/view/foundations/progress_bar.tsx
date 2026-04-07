import * as React from 'react';
import * as styles from './progress_bar.module.css';

import { classNames } from '../../utils/classnames.js';

interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
    progress: number;
    className?: string;
}

export function ProgressBar(props: ProgressBarProps): React.ReactElement {
    const { className, progress, ...rest } = props;
    const clampedProgress = Math.max(0, Math.min(progress, 100));
    return (
        <div
            {...rest}
            className={classNames(styles.root, className)}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clampedProgress)}
        >
            <div className={styles.fill} style={{ width: `${clampedProgress}%` }} />
        </div>
    );
}
