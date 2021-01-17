import * as React from 'react';
import { Chart } from 'chart.js';

import styles from './widgets.module.css';

type IntegerParameterProps = {
    name: string;
    value: number | null;
    onChange: (name: string, value: number | null) => void;
};

export class IntegerParameter extends React.Component<IntegerParameterProps> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = parseInt(target.value);

        if (Number.isNaN(value)) {
            this.props.onChange(this.props.name, null);
        } else {
            this.props.onChange(this.props.name, value);
        }
    };

    render() {
        return (
            <input className={styles.input} type="number" value={this.props.value ?? ''} onChange={this.handleChange} />
        );
    }
}

type FloatParameterProps = {
    name: string;
    value: number | null;
    onChange: (name: string, value: number | null) => void;
};

export class FloatParameter extends React.Component<FloatParameterProps> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = parseFloat(target.value);

        if (Number.isNaN(value)) {
            this.props.onChange(this.props.name, null);
        } else {
            this.props.onChange(this.props.name, value);
        }
    };

    render() {
        return (
            <input
                className={styles.input}
                type="number"
                step="any"
                value={this.props.value ?? ''}
                onChange={this.handleChange}
            />
        );
    }
}

type TextParameterProps = {
    name: string;
    value: string | null;
    onChange: (name: string, value: string | null) => void;
};
export class TextParameter extends React.Component<TextParameterProps> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = target.value;

        if (value) {
            this.props.onChange(this.props.name, target.value);
        } else {
            this.props.onChange(this.props.name, null);
        }
    };

    render() {
        return (
            <input className={styles.input} type="text" value={this.props.value ?? ''} onChange={this.handleChange} />
        );
    }
}

type DateParameterProps = {
    name: string;
    value: string | null;
    onChange: (name: string, value: {} | null) => void;
};

export class DateParameter extends React.Component<DateParameterProps> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = target.value;

        if (value) {
            this.props.onChange(this.props.name, value);
        } else {
            this.props.onChange(this.props.name, null);
        }
    };

    formatDate(date?: Date) {
        if (!date) {
            return '';
        }

        const year = date.getFullYear().toString().padStart(4, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');

        return `${year}-${month}-${day}`;
    }

    render() {
        return (
            <input className={styles.input} type="date" value={this.props.value ?? ''} onChange={this.handleChange} />
        );
    }
}

type DatetimeParameterProps = {
    name: string;
    value: string | null;
    onChange: (name: string, value: string | null) => void;
};

export class DatetimeParameter extends React.Component<DatetimeParameterProps> {
    handleChangeDate = (event: React.ChangeEvent<HTMLInputElement>) => {
        const dateRef = this.refs.date as HTMLInputElement | undefined;
        const timeRef = this.refs.time as HTMLInputElement | undefined;

        if (!dateRef || !timeRef) {
            return;
        }

        if (dateRef.value) {
            const date = dateRef.value;
            const time = timeRef.value || '00:00:00';

            this.props.onChange(this.props.name, `${date} ${time}`);
        } else {
            this.props.onChange(this.props.name, null);
        }
    };

    handleChangeTime = (event: React.ChangeEvent<HTMLInputElement>) => {
        const dateRef = this.refs.date as HTMLInputElement | undefined;
        const timeRef = this.refs.time as HTMLInputElement | undefined;

        if (!dateRef || !timeRef) {
            return;
        }

        if (timeRef.value) {
            const date = dateRef.value || this.formatDate(new Date());
            const time = timeRef.value;

            this.props.onChange(this.props.name, `${date} ${time}`);
        } else {
            this.props.onChange(this.props.name, null);
        }
    };

    formatDate(date?: Date) {
        if (!date) {
            return '';
        }

        const year = date.getFullYear().toString().padStart(4, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');

        return `${year}-${month}-${day}`;
    }

    formatTime(date?: Date) {
        if (!date) {
            return '';
        }

        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');

        return `${hours}:${minutes}:${seconds}`;
    }

    render() {
        return (
            <span className={styles.input}>
                <input
                    ref="date"
                    className={styles.input_fragment}
                    type="date"
                    value={this.props.value ?? ''}
                    onChange={this.handleChangeDate}
                />
                <input
                    ref="time"
                    className={styles.input_fragment}
                    type="time"
                    step="1"
                    value={this.props.value ?? ''}
                    onChange={this.handleChangeTime}
                />
            </span>
        );
    }
}

type TimeParameterProps = {
    name: string;
    value: string | null;
    onChange: (name: string, value: string | null) => void;
};

export class TimeParameter extends React.Component<TimeParameterProps> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = target.value;

        if (value) {
            this.props.onChange(this.props.name, value);
        } else {
            this.props.onChange(this.props.name, null);
        }
    };

    formatTime(date?: Date) {
        if (!date) {
            return '';
        }

        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');

        return `${hours}:${minutes}:${seconds}`;
    }

    render() {
        return (
            <input
                className={styles.input}
                type="time"
                step="1"
                value={this.props.value ?? ''}
                onChange={this.handleChange}
            />
        );
    }
}

type FileParameterProps = {
    name: string;
    value: File | null;
    onChange: (name: string, value: File | null) => void;
};

export class FileParameter extends React.Component<FileParameterProps> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = target.files?.item(0);

        if (value) {
            this.props.onChange(this.props.name, value);
        } else {
            this.props.onChange(this.props.name, null);
        }
    };

    render() {
        return <input className={styles.input} type="file" onChange={this.handleChange} />;
    }
}

export class AreaChart extends React.Component {
    render() {
        return null;
    }
}

export class BarChart extends React.Component {
    chart!: Chart;

    componentDidMount() {
        const context = (this.refs.chart as HTMLCanvasElement).getContext('2d')!;

        this.chart = new Chart(context, {
            type: 'bar',
            data: {
                labels: ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'],
                datasets: [
                    {
                        label: '# of Votes',
                        data: [12, 19, 3, 5, 2, 3],
                        backgroundColor: [
                            'rgba(255, 99, 132, 0.2)',
                            'rgba(54, 162, 235, 0.2)',
                            'rgba(255, 206, 86, 0.2)',
                            'rgba(75, 192, 192, 0.2)',
                            'rgba(153, 102, 255, 0.2)',
                            'rgba(255, 159, 64, 0.2)',
                        ],
                        borderColor: [
                            'rgba(255, 99, 132, 1)',
                            'rgba(54, 162, 235, 1)',
                            'rgba(255, 206, 86, 1)',
                            'rgba(75, 192, 192, 1)',
                            'rgba(153, 102, 255, 1)',
                            'rgba(255, 159, 64, 1)',
                        ],
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                scales: {
                    yAxes: [
                        {
                            ticks: {
                                beginAtZero: true,
                            },
                        },
                    ],
                },
            },
        });
    }

    render() {
        return <canvas ref="chart" />;
    }
}

export class BoxChart extends React.Component {
    render() {
        return null;
    }
}

export class BubbleChart extends React.Component {
    render() {
        return null;
    }
}

export class GridChart extends React.Component {
    render() {
        return null;
    }
}

export class HistogramChart extends React.Component {
    render() {
        return null;
    }
}

export class LineChart extends React.Component {
    render() {
        return null;
    }
}

export class NumberChart extends React.Component {
    render() {
        return null;
    }
}

export class PieChart extends React.Component {
    render() {
        return null;
    }
}

export class PointChart extends React.Component {
    render() {
        return null;
    }
}

export class ScatterChart extends React.Component {
    render() {
        return null;
    }
}

export class TableChart extends React.Component {
    render() {
        return null;
    }
}

export class TextChart extends React.Component {
    render() {
        return null;
    }
}
