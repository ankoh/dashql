import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@tigon/proto';
import {
    RootState,
    Dispatch,
    setTQLArgument,
    unsetTQLArgument,
    Argument,
} from '../../../../store';

import styles from './input.module.scss';

type OwnProps = {
    name: string;
};

type Props = { dispatch: Dispatch } & ReturnType<typeof mapStateToProps> &
    OwnProps;

class DatetimeInput extends React.Component<Props> {
    handleChangeDate = (event: React.ChangeEvent<HTMLInputElement>) => {
        const dateRef = this.refs.date as HTMLInputElement | undefined;
        const timeRef = this.refs.time as HTMLInputElement | undefined;

        if (!dateRef || !timeRef) {
            return;
        }

        if (dateRef.value) {
            const date = dateRef.value;
            const time = timeRef.value || '00:00:00';

            const value = new Date(`${date} ${time}`);

            this.props.dispatch(
                setTQLArgument(this.props.name, {
                    type: proto.tql.ParameterTypeType.DATETIME,
                    value,
                }),
            );
        } else {
            this.props.dispatch(unsetTQLArgument(this.props.name));
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

            const value = new Date(`${date} ${time}`);

            this.props.dispatch(
                setTQLArgument(this.props.name, {
                    type: proto.tql.ParameterTypeType.DATETIME,
                    value,
                }),
            );
        } else {
            this.props.dispatch(unsetTQLArgument(this.props.name));
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
                    value={this.formatDate(this.props.argument?.value)}
                    onChange={this.handleChangeDate}
                />
                <input
                    ref="time"
                    className={styles.input_fragment}
                    type="time"
                    step="1"
                    value={this.formatTime(this.props.argument?.value)}
                    onChange={this.handleChangeTime}
                />
            </span>
        );
    }
}

const getDatetimeArgument = (argument: Argument | undefined) => {
    if (argument?.type != proto.tql.ParameterTypeType.DATETIME) {
        return null;
    }

    return argument;
};

const mapStateToProps = (state: RootState, props: OwnProps) => {
    return {
        argument: getDatetimeArgument(state.tqlArguments.get(props.name)),
    };
};

export default connect(mapStateToProps)(DatetimeInput);
