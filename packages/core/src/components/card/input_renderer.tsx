import * as proto from '@dashql/proto';
import * as React from 'react';
import * as model from '../../model';
import * as utils from '../../utils';
import { Form, InputGroup } from 'react-bootstrap';

//import icon_textbox from '../../static/svg/icons/form_textbox.svg';

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

export const InputRenderer: React.FC<Props> = (props: Props) => {
    const valueType = props.card.inputValueType?.typeId() ?? proto.sql.SQLTypeID.ANY;
    return (
        <div className={styles.container}>
            <InputGroup className={styles.input_group}>
                <InputGroup.Text className={styles.input_title}>{utils.formatTitle(props.card.title)}</InputGroup.Text>
                <Form.Control className={styles.input_text} type="text" placeholder={proto.sql.SQLTypeID[valueType]} />
            </InputGroup>
        </div>
    );
};
