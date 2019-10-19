import * as React from 'react';
import classNames from 'classnames';
import './spinners.css';

export class FillingBoxSpinner extends React.PureComponent<{ counter: number }> {
    public render() {
        return (
            <div className="FillingBoxSpinner">
                <div
                    className={classNames(
                        'FillingBoxSpinner-Outline',
                        (this.props.counter > 0)
                            ? ('FillingBoxSpinner-State-' + ((this.props.counter & 1) ? '1' : '0'))
                            : undefined
                    )}
                >
                    <div className="FillingBoxSpinner-Box" />
                </div>
            </div>
        );
    }
}

export class PulsingCircleSpinner extends React.PureComponent<{ counter: number }> {
    public render() {
        return (
            <div className="PulsingCircleSpinner">
                <div
                    className={classNames(
                        'PulsingCircleSpinner-Outline',
                        (this.props.counter > 0)
                            ? ('PulsingCircleSpinner-State-' + ((this.props.counter & 1) ? '1' : '0'))
                            : undefined
                    )}
                >
                    <div className="PulsingCircleSpinner-Circle" />
                </div>
            </div>
        );
    }
}

interface IRectangleWaveSpinnerProps {
    color?: string;
}

export class RectangleWaveSpinner extends React.PureComponent<IRectangleWaveSpinnerProps> {
    public render() {
        const rectStyle = {
            backgroundColor: this.props.color || "white"
        };
        return (
            <div className="rectangle_wave_spinner">
                <div className="rectangle_wave_spinner_rect_1" style={rectStyle} />
                <div className="rectangle_wave_spinner_rect_2" style={rectStyle} />
                <div className="rectangle_wave_spinner_rect_3" style={rectStyle} />
                <div className="rectangle_wave_spinner_rect_4" style={rectStyle} />
                <div className="rectangle_wave_spinner_rect_5" style={rectStyle} />
            </div>
        );
    }
}

