import * as React from 'react';
import * as model from '../../model';

import styles from './input_renderer.module.css';

interface Props {
    card: model.CardSpecification;
    editable?: boolean;
}

//export const InputRenderer: React.FC<Props> = (props: Props) => {
//    return (
//        <div className={styles.container}>
//            <div className={styles.input_label}>{props.card.title || ''}</div>
//        </div>
//    );
//};

import { Form } from 'react-bootstrap';
export const InputRenderer: React.FC<Props> = (props: Props) => {
    return (
        <Form className={styles.container}>
            <Form.Group controlId={props.card.objectId.toString()}>
                <Form.Control className={styles.input_text} type="text" placeholder={props.card.title ?? ''} />
            </Form.Group>
        </Form>
    );
};
