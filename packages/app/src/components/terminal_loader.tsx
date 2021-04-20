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

export default class TerminalLoader extends React.Component<Props> {
    public render(): React.ReactElement {
        return (
            <React.Suspense fallback={loadingSpinner(this.props)}>
                <Terminal {...this.props} />
            </React.Suspense>
        );
    }
}
