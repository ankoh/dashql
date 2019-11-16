import * as React from 'react';
import cN from 'classnames';
import s from './spinners.module.scss';

interface IRectangleWaveSpinnerProps {
    color?: string;
    active: boolean;
}

export class RectangleWaveSpinner extends React.PureComponent<IRectangleWaveSpinnerProps> {
    public render() {
        const rectStyle = {
            backgroundColor: this.props.color || "white"
        };
        return (
            <div className={s.rectangle_wave}>
                <div className={cN(s.rectangle_wave_rect_1, { [s.active]: this.props.active })} style={rectStyle} />
                <div className={cN(s.rectangle_wave_rect_2, { [s.active]: this.props.active })} style={rectStyle} />
                <div className={cN(s.rectangle_wave_rect_3, { [s.active]: this.props.active })} style={rectStyle} />
                <div className={cN(s.rectangle_wave_rect_4, { [s.active]: this.props.active })} style={rectStyle} />
                <div className={cN(s.rectangle_wave_rect_5, { [s.active]: this.props.active })} style={rectStyle} />
            </div>
        );
    }
}

