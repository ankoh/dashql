import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@tigon/proto';
import { isPresent } from '../../util/functional';
import { RootState } from '../../store';

import styles from './arguments.module.scss';

type Props = ReturnType<typeof mapStateToProps>;

class Arguments extends React.Component<Props> {
    renderInput(type: ValueOf<proto.tql.ParameterTypeTypeMap>) {
        switch (type) {
            case proto.tql.ParameterTypeType.INTEGER:
                return <input className={styles.input} type="number" />;
            case proto.tql.ParameterTypeType.FLOAT:
                return (
                    <input className={styles.input} type="number" step="any" />
                );
            case proto.tql.ParameterTypeType.TEXT:
                return <input className={styles.input} type="text" />;
            case proto.tql.ParameterTypeType.DATE:
                return <input className={styles.input} type="date" />;
            case proto.tql.ParameterTypeType.DATETIME:
                return <input className={styles.input} type="datetime-local" />;
            case proto.tql.ParameterTypeType.TIME:
                return <input className={styles.input} type="time" />;
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

                const type =
                    parameter.getType()?.getType() ??
                    proto.tql.ParameterTypeType.TEXT;

                const input = this.renderInput(type);

                return (
                    <div>
                        <span className={styles.argument_name}>{name}:</span>
                        {input}
                    </div>
                );
            });

        return <div className={styles.arguments}>{parameters}</div>;
    }
}

const mapStateToProps = (state: RootState) => ({
    module: state.tqlModule,
});

export default connect(mapStateToProps)(Arguments);
