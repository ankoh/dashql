import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as utils from '../utils';
import { InputSpec, ScalarValue } from '../model';
import { readCoreArrowType } from '../model/table_metadata';
import { useWorkflowSession, useWorkflowSessionState } from '../backend/workflow_session';

import { Form, InputGroup, Button } from 'react-bootstrap';

import icon_textbox from '../../static/svg/icons/form_textbox.svg';

import styles from './input_text_renderer.module.css';

interface Props {
    statementId: number;
    data: InputSpec;
    editable?: boolean;
}

export const InputTextRenderer: React.FC<Props> = (props: Props) => {
    const session = useWorkflowSession();
    const sessionState = useWorkflowSessionState();
    const target = React.useRef(null);
    const size = utils.observeSize(target);

    const valueType = React.useMemo(() => readCoreArrowType(props.data.value_type), [props.data.value_type]);

    const onSubmit = React.useCallback(
        (event: any) => {
            event.preventDefault();
            if (!session) {
                return;
            }
            const raw = (event.target as any).value;
            let value: ScalarValue;
            switch (valueType.typeId) {
                case arrow.Type.Bool:
                    value = {
                        t: 'boolean',
                        v: raw == 'true' || raw == '1',
                    };
                    break;
                case arrow.Type.Int8:
                case arrow.Type.Int32:
                case arrow.Type.Int64:
                case arrow.Type.Uint8:
                case arrow.Type.Uint16:
                case arrow.Type.Uint32:
                case arrow.Type.Uint64:
                    value = {
                        t: 'int64',
                        v: parseInt(raw),
                    };
                    break;
                case arrow.Type.Float32:
                case arrow.Type.Float64:
                    value = {
                        t: 'float64',
                        v: parseFloat(raw),
                    };
                    break;
                default:
                    value = {
                        t: 'utf8',
                        v: raw,
                    };
                    break;
            }
            session.updateProgramInput(props.statementId, value);
        },
        [props.statementId, sessionState.programInput, session, valueType],
    );

    if (props.data.renderer.t != 'Text') {
        return <div />;
    }

    const card = sessionState.programAnalysis.cards[props.statementId];
    const inputData = props.data.renderer.v;

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
                <Form className={styles.input_group} onSubmit={onSubmit}>
                    <InputGroup>
                        <InputGroup.Text className={styles.input_title}>
                            {utils.formatTitle(card.title)}
                        </InputGroup.Text>
                        <Form.Control className={styles.input_text} type="text" placeholder={inputData.placeholder} />
                    </InputGroup>
                </Form>
            );
        }
    }
    return (
        <div ref={target} className={styles.container}>
            {inner}
        </div>
    );
};
