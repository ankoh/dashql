import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@dashql/proto';
import { isPresent } from '../../../util/functional';
import { RootState } from '../../../store';
import IntegerInput from './inputs/integer_input';
import FloatInput from './inputs/float_input';
import TextInput from './inputs/text_input';
import DateInput from './inputs/date_input';
import DatetimeInput from './inputs/datetime_input';
import TimeInput from './inputs/time_input';
import FileInput from './inputs/file_input';

import styles from './arguments.module.scss';

type Props = ReturnType<typeof mapStateToProps>;

class Arguments extends React.Component<Props> {
    renderInput(parameter: proto.tql.ParameterDeclaration) {
        const type = parameter.getType()?.getType();
        const name = parameter.getName()?.getString();

        if (type == undefined || !name) {
            return null;
        }

        switch (type) {
            case proto.tql.ParameterTypeType.INTEGER:
                return <IntegerInput name={name} />;
            case proto.tql.ParameterTypeType.FLOAT:
                return <FloatInput name={name} />;
            case proto.tql.ParameterTypeType.TEXT:
                return <TextInput name={name} />;
            case proto.tql.ParameterTypeType.DATE:
                return <DateInput name={name} />;
            case proto.tql.ParameterTypeType.DATETIME:
                return <DatetimeInput name={name} />;
            case proto.tql.ParameterTypeType.TIME:
                return <TimeInput name={name} />;
            case proto.tql.ParameterTypeType.FILE:
                return <FileInput name={name} />;
        }
    }

    render() {
        const parameters = this.props.module
            .getStatementsList()
            .map(
                statement =>
                    (statement.hasParameter() && statement.getParameter()) ||
                    null,
            )
            .filter(isPresent)
            .map(parameter => {
                const name = parameter.getName()?.getString() ?? '';
                const label = parameter.getLabel()?.getString() ?? '';

                return (
                    <div className={styles.argument} key={name}>
                        <span className={styles.argument_name}>{label}:</span>
                        {this.renderInput(parameter)}
                    </div>
                );
            });

        if (parameters.length <= 0) {
            return null;
        }

        return <div className={styles.arguments}>{parameters}</div>;
    }
}

const mapStateToProps = (state: RootState) => ({
    module: state.tqlModule,
});

export default connect(mapStateToProps)(Arguments);
