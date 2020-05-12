import * as React from 'react';
import classNames from 'classnames';
import styles from './spinners.module.scss';

interface IRectangleWaveSpinnerProps {
    color?: string;
    active: boolean;
}

export class RectangleWaveSpinner extends React.PureComponent<
    IRectangleWaveSpinnerProps
> {
    public render() {
        const rectStyle = {
            backgroundColor: this.props.color || 'white',
        };
        return (
            <div className={styles.rectangle_wave}>
                <div
                    className={classNames(styles.rectangle_wave_rect_1, {
                        [styles.active]: this.props.active,
                    })}
                    style={rectStyle}
                />
                <div
                    className={classNames(styles.rectangle_wave_rect_2, {
                        [styles.active]: this.props.active,
                    })}
                    style={rectStyle}
                />
                <div
                    className={classNames(styles.rectangle_wave_rect_3, {
                        [styles.active]: this.props.active,
                    })}
                    style={rectStyle}
                />
                <div
                    className={classNames(styles.rectangle_wave_rect_4, {
                        [styles.active]: this.props.active,
                    })}
                    style={rectStyle}
                />
                <div
                    className={classNames(styles.rectangle_wave_rect_5, {
                        [styles.active]: this.props.active,
                    })}
                    style={rectStyle}
                />
            </div>
        );
    }
}
