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

class FileInput extends React.Component<Props> {
    handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        const value = target.files?.item(0);

        if (value) {
            this.props.dispatch(
                setTQLArgument(this.props.name, {
                    type: proto.tql.ParameterTypeType.FILE,
                    value,
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
                type="file"
                onChange={this.handleChange}
            />
        );
    }
}

const getFileArgument = (argument: Argument | undefined) => {
    if (argument?.type != proto.tql.ParameterTypeType.FILE) {
        return null;
    }

    return argument;
};

const mapStateToProps = (state: RootState, props: OwnProps) => {
    return {
        argument: getFileArgument(state.tqlArguments.get(props.name)),
    };
};

export default connect(mapStateToProps)(FileInput);
