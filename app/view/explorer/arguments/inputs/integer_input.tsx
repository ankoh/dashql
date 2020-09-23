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

class IntegerInput extends React.Component<Props> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = parseInt(target.value);

        if (Number.isNaN(value)) {
            this.props.dispatch(unsetTQLArgument(this.props.name));
        } else {
            this.props.dispatch(
                setTQLArgument(this.props.name, {
                    type: proto.tql.ParameterTypeType.INTEGER,
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
                value={this.props.argument?.value?.toString() ?? ''}
                onChange={this.handleChange}
            />
        );
    }
}

const getIntegerArgument = (argument: Argument | undefined) => {
    if (argument?.type != proto.tql.ParameterTypeType.INTEGER) {
        return null;
    }

    return argument;
};

const mapStateToProps = (state: RootState, props: OwnProps) => {
    return {
        argument: getIntegerArgument(state.tqlArguments.get(props.name)),
    };
};

export default connect(mapStateToProps)(IntegerInput);
