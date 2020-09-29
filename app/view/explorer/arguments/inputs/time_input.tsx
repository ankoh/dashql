import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@dashql/proto';
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

class TimeInput extends React.Component<Props> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = target.value;

        if (value) {
            this.props.dispatch(
                setTQLArgument(this.props.name, {
                    type: proto.tql.ParameterTypeType.TIME,
                    value,
                }),
            );
        } else {
            this.props.dispatch(unsetTQLArgument(this.props.name));
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
                value={this.props.argument?.value}
                onChange={this.handleChange}
            />
        );
    }
}

const getTimeArgument = (argument: Argument | undefined) => {
    if (argument?.type != proto.tql.ParameterTypeType.TIME) {
        return null;
    }

    return argument;
};

const mapStateToProps = (state: RootState, props: OwnProps) => {
    return {
        argument: getTimeArgument(state.tqlArguments.get(props.name)),
    };
};

export default connect(mapStateToProps)(TimeInput);
