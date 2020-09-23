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

class FloatInput extends React.Component<Props> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = parseFloat(target.value);

        if (Number.isNaN(value)) {
            this.props.dispatch(unsetTQLArgument(this.props.name));
        } else {
            this.props.dispatch(
                setTQLArgument(this.props.name, {
                    type: proto.tql.ParameterTypeType.FLOAT,
                    value,
                }),
            );
        }
    };

    render() {
        return (
            <input
                className={styles.input}
                type="number"
                step="any"
                value={this.props.argument?.value?.toString() ?? ''}
                onChange={this.handleChange}
            />
        );
    }
}

const getFloatArgument = (argument: Argument | undefined) => {
    if (argument?.type != proto.tql.ParameterTypeType.FLOAT) {
        return null;
    }

    return argument;
};

const mapStateToProps = (state: RootState, props: OwnProps) => {
    return {
        argument: getFloatArgument(state.tqlArguments.get(props.name)),
    };
};

export default connect(mapStateToProps)(FloatInput);
