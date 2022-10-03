import * as React from 'react';
import * as utils from '../utils';
import { InputSpec } from '../model';
import { readCoreArrowType } from '../model/table_metadata';
import { useWorkflowSessionState } from '../backend/workflow_session';

import { Form, InputGroup, Button } from 'react-bootstrap';

import icon_textbox from '../../static/svg/icons/form_textbox.svg';

import styles from './input_text_renderer.module.css';

interface Props {
    statementId: number;
    data: InputSpec;
    editable?: boolean;
}

export const InputTextRenderer: React.FC<Props> = (props: Props) => {
    const sessionState = useWorkflowSessionState();
    const target = React.useRef(null);
    const size = utils.observeSize(target);

    if (props.data.renderer.t != 'Text') {
        return <div />;
    }

    const card = sessionState.programAnalysis.cards[props.statementId];
    const inputData = props.data.renderer.v;
    const _valueType = readCoreArrowType(props.data.value_type);

    let inner: React.ReactElement;
    if (size == null) {
        inner = <div />;
    } else {
        if (size.width <= 80) {
            inner = (
                <Button className={styles.input_placeholder_button}>
                    <svg className={styles.input_placeholder_icon} width="16px" height="16px">
                        <use xlinkHref={`${icon_textbox}#sym`} />
                    </svg>
                </Button>
            );
        } else if (size.width <= 160) {
            inner = (
                <Button className={styles.input_placeholder_button}>
                    <svg className={styles.input_placeholder_icon} width="16px" height="16px">
                        <use xlinkHref={`${icon_textbox}#sym`} />
                    </svg>
                    <div className={styles.input_placeholder_text}>{utils.formatTitle(card.title)}</div>
                </Button>
            );
        } else {
            inner = (
                <InputGroup className={styles.input_group}>
                    <InputGroup.Text className={styles.input_title}>{utils.formatTitle(card.title)}</InputGroup.Text>
                    <Form.Control className={styles.input_text} type="text" placeholder={inputData.placeholder} />
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
