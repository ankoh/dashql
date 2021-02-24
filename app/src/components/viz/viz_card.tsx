import * as React from 'react';
import classNames from 'classnames';
import styles from './viz_card.module.css';

interface Props {
    children?: JSX.Element;
    className?: string;
}

export class VizCard extends React.Component<Props> {
    public render() {
        return (
            <div className={classNames(styles.card, this.props.className)}>
                {this.props.children}
            </div>
        );
    }
}