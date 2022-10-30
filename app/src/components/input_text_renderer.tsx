import * as React from 'react';
import * as utils from '../utils';
import { formatScalarValue, InputSpec, parseScalarValue, ScalarValue } from '../model';
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

type FormControlElement = HTMLInputElement | HTMLTextAreaElement;

export const InputTextRenderer: React.FC<Props> = (props: Props) => {
    const session = useWorkflowSession();
    const sessionState = useWorkflowSessionState();
    const target = React.useRef(null);
    const size = utils.observeSize(target);
    const inputRef = React.useRef<HTMLInputElement>();
    const parameters = sessionState.programAnalysis.parameters;
    const valueType = React.useMemo(() => readCoreArrowType(props.data.value_type), [props.data.value_type]);
    const value = parameters[props.statementId] ?? null;

    const [text, setText] = React.useState(value == null ? undefined : formatScalarValue(value));

    const onSubmit = React.useCallback(
        (event: any) => {
            event.preventDefault();
            if (!session) {
                return;
            }
            let raw = inputRef.current?.value ?? '';
            let value = parseScalarValue(raw, valueType);
            session.updateProgramInput(props.statementId, value);
        },
        [props.statementId, parameters, session, valueType],
    );
    const onChange = React.useCallback(
        (event: React.ChangeEvent<FormControlElement>) => {
            let value = parseScalarValue(event.target.value, valueType);
            setText(formatScalarValue(value));
        },
        [valueType],
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
                        <Form.Control
                            className={styles.input_text}
                            ref={inputRef}
                            type="text"
                            placeholder={inputData.placeholder}
                            value={text}
                            onChange={onChange}
                        />
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
