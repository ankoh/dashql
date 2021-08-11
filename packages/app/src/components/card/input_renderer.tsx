import * as React from 'react';
import * as model from '../../model';
import { InputGroup, FormControl } from 'react-bootstrap';

import styles from './input_renderer.module.css';

interface Props {
    card: model.CardSpecification;
    editable?: boolean;
}

export const InputRenderer: React.FC<Props> = (props: Props) => {
    return (
        <div className={styles.container}>
            <div className={styles.input_prefix}>{props.card.title || ''}</div>
            <div className={styles.input_group_container}>
                <InputGroup size="sm">
                    <FormControl aria-label="Default" aria-describedby="inputGroup-sizing-default" />
                </InputGroup>
            </div>
        </div>
    );
};
