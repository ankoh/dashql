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

class TextInput extends React.Component<Props> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = target.value;

        if (value) {
            this.props.dispatch(
                setTQLArgument(this.props.name, {
                    type: proto.tql.ParameterTypeType.TEXT,
                    value: target.value,
                }),
            );
        } else {
            this.props.dispatch(unsetTQLArgument(this.props.name));
        }
    };

    render() {
        return (
            <input
                className={styles.input}
                type="text"
                value={this.props.argument?.value?.toString() ?? ''}
                onChange={this.handleChange}
            />
        );
    }
}

const getTextArgument = (argument: Argument | undefined) => {
    if (argument?.type != proto.tql.ParameterTypeType.TEXT) {
        return null;
    }

    return argument;
};

const mapStateToProps = (state: RootState, props: OwnProps) => {
    return {
        argument: getTextArgument(state.tqlArguments.get(props.name)),
    };
};

export default connect(mapStateToProps)(TextInput);
