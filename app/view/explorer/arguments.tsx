import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@tigon/proto';
import { isPresent } from '../../util/functional';
import { RootState } from '../../store';

import styles from './arguments.module.scss';

type Props = ReturnType<typeof mapStateToProps>;

class Arguments extends React.Component<Props> {
    renderInput(type: ValueOf<proto.tql.DataTypeTypeMap>) {
        switch (type) {
            case proto.tql.DataTypeType.INTEGER:
                return <input type="number" />;
            case proto.tql.DataTypeType.FLOAT:
                return <input type="number" step="any" />;
            case proto.tql.DataTypeType.TEXT:
                return <input type="text" />;
            case proto.tql.DataTypeType.DATE:
                return <input type="date" />;
            case proto.tql.DataTypeType.DATETIME:
                return <input type="datetime-local" />;
            case proto.tql.DataTypeType.TIME:
                return <input type="time" />;
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
                    parameter.getDataType()?.getType() ??
                    proto.tql.DataTypeType.TEXT;

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
