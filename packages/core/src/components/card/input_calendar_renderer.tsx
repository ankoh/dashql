import * as proto from '@dashql/proto';
import * as React from 'react';
import * as model from '../../model';
import * as utils from '../../utils';
import { Form, InputGroup, Button } from 'react-bootstrap';

import icon_calendar from '../../../static/svg/icons/calendar.svg';

import styles from './input_calendar_renderer.module.css';

interface Props {
    card: model.CardSpecification;
    editable?: boolean;
}

// http://react-day-picker.js.org/

export const InputCalendarRenderer: React.FC<Props> = (props: Props) => {
    const target = React.useRef(null);
    const size = utils.observeSize(target);
    const valueType = props.card.inputValueType?.typeId() ?? proto.sql.SQLTypeID.ANY;

    let inner: React.ReactElement;
    if (size == null) {
        inner = <div />;
    } else {
        if (size.width <= 80) {
            inner = (
                <Button className={styles.input_placeholder_button}>
                    <svg className={styles.input_placeholder_icon} width="16px" height="16px">
                        <use xlinkHref={`${icon_calendar}#sym`} />
                    </svg>
                </Button>
            );
        } else if (size.width <= 160) {
            inner = (
                <Button className={styles.input_placeholder_button}>
                    <svg className={styles.input_placeholder_icon} width="16px" height="16px">
                        <use xlinkHref={`${icon_calendar}#sym`} />
                    </svg>
                    <div className={styles.input_placeholder_text}>{utils.formatTitle(props.card.title)}</div>
                </Button>
            );
        } else {
            inner = (
                <InputGroup className={styles.input_group}>
                    <InputGroup.Text className={styles.input_title}>
                        {utils.formatTitle(props.card.title)}
                    </InputGroup.Text>
                    <Form.Control
                        className={styles.input_text}
                        type="text"
                        placeholder={proto.sql.SQLTypeID[valueType]}
                    />
                </InputGroup>
            );
        }
    }
    return (
        <div ref={target} className={styles.container}>
            {inner}
        </div>
    );
};
