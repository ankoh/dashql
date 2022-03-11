import * as React from 'react';
import * as model from '../../model';
//import { Form } from 'react-bootstrap';

import styles from './input_renderer.module.css';

interface Props {
    card: model.CardSpecification;
    editable?: boolean;
}

export const InputRenderer: React.FC<Props> = (props: Props) => {
    return (
        <div className={styles.container}>
            <div className={styles.input_label}>{props.card.title || ''}</div>
        </div>
    );
};

//        <Form className={styles.container}>
//            <Form.Group className="mb-2" controlId={props.card.objectId.toString()}>
//                <Form.Control type="text" placeholder={props.card.title ?? ''} />
//            </Form.Group>
//        </Form>
