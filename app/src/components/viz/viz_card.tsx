import * as React from 'react';
import { SettingsIcon } from '../../svg/icons';
import styles from './viz_card.module.css';
import Button from 'react-bootstrap/Button';

interface Props {
    children?: JSX.Element[] | JSX.Element;
    className?: string;
    title?: string;
}

export const VizCard: React.FC<Props> = (props: Props) => {
    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.title}>
                    {props.title}
                </div>
                <Button size="sm" variant="light" className={styles.settings}>
                    <SettingsIcon fill='rgb(80, 80, 80)' width='14px' height='14px'  />
                </Button>
            </div>
            <div className={styles.body}>
                {props.children}
            </div>
        </div>
    );
};