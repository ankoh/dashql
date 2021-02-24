import * as React from 'react';
import styles from './viz_card.module.css';

interface Props {
    children?: JSX.Element[] | JSX.Element;
    className?: string;
    title?: string;
}

export class VizCard extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <div className={styles.title}>
                        {this.props.title}
                    </div>
                </div>
                <div className={styles.body}>
                    {this.props.children}
                </div>
            </div>
        );
    }
}