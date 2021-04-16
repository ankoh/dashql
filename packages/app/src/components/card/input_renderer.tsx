import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';
import { InputGroup, FormControl } from 'react-bootstrap';

import styles from './input_renderer.module.css';

interface Props {
    appContext: IAppContext;
    tables: Immutable.Map<string, core.model.DatabaseTable>;
    card: core.model.Card;
    editable?: boolean;
}

export class InputRenderer extends React.Component<Props> {
    public render(): React.ReactElement {
        return (
            <div className={styles.container}>
                <div className={styles.input_prefix}>{this.props.card.title || ''}</div>
                <div className={styles.input_group_container}>
                    <InputGroup size="sm">
                        <FormControl aria-label="Default" aria-describedby="inputGroup-sizing-default" />
                    </InputGroup>
                </div>
            </div>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    tables: state.core.databaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(InputRenderer));
