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

class DateInput extends React.Component<Props> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = target.value;

        if (value) {
            this.props.dispatch(
                setTQLArgument(this.props.name, {
                    type: proto.tql.ParameterTypeType.DATE,
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

    render() {
        return (
            <input
                className={styles.input}
                type="date"
                value={this.props.argument?.value}
                onChange={this.handleChange}
            />
        );
    }
}

const getDateArgument = (argument: Argument | undefined) => {
    if (argument?.type != proto.tql.ParameterTypeType.DATE) {
        return null;
    }

    return argument;
};

const mapStateToProps = (state: RootState, props: OwnProps) => {
    return {
        argument: getDateArgument(state.tqlArguments.get(props.name)),
    };
};

export default connect(mapStateToProps)(DateInput);
