import * as React from 'react';

import * as styles from './keyvalue_list.module.css';

import { Dispatch } from '../../utils/variant.js';
import { PlusIcon, XIcon } from '@primer/octicons-react';
import { classNames } from '../../utils/classnames.js';
import { TextInput } from './text_input.js';
import { TextInputAction } from './text_input_action.js';
import { ButtonSize, IconButton } from './button.js';

export interface KeyValueListElement {
    key: string;
    value: string;
}

export type UpdateKeyValueList = (prev: KeyValueListElement[]) => KeyValueListElement[];

interface Props {
    className?: string;
    title: string;
    caption: string;
    keyIcon: React.ElementType;
    valueIcon: React.ElementType;
    addButtonLabel: string;
    elements: KeyValueListElement[];
    modifyElements: Dispatch<UpdateKeyValueList>;
    disabled?: boolean;
    readOnly?: boolean;
}

export const KeyValueListBuilder: React.FC<Props> = (props: Props) => {
    const appendElement = () => props.modifyElements(list => {
        const copy = [...list];
        copy.push({
            key: "",
            value: "",
        });
        return copy;
    });
    const deleteIndex = (index: number) => props.modifyElements(list => {
        const copy = [...list];
        copy.splice(index, 1);
        return copy;
    });
    const modifyElement = (index: number, key: string, value: string) => props.modifyElements(list => {
        const copy = [...list];
        copy[index] = { key, value };
        return copy;
    });
    return (
        <div className={classNames(props.className, styles.list)}>
            <div className={styles.list_name}>
                {props.title}
            </div>
            <div className={styles.list_caption}>
                {props.caption}
            </div>
            <IconButton
                className={styles.add_button}
                aria-label="Add Entry"
                onClick={appendElement}
                disabled={props.disabled}
                size={ButtonSize.Small}
            >
                <PlusIcon />
            </IconButton>
            <div className={styles.list_elements}>
                {props.elements.map((elem, i) => (
                    <div key={i} className={styles.element}>
                        <TextInput
                            block
                            className={styles.path}
                            value={elem.key}
                            onChange={(ev: any) => modifyElement(i, ev.target.value, elem.value)}
                            leadingVisual={props.keyIcon}
                            trailingAction={
                                <TextInputAction
                                    aria-label="Clear input"
                                    aria-labelledby=""
                                    onClick={() => deleteIndex(i)}
                                >
                                    <XIcon />
                                </TextInputAction>
                            }
                            disabled={props.disabled}
                            readOnly={props.disabled}
                        />
                        <div className={styles.aliaslink} />
                        <TextInput
                            block
                            className={styles.alias}
                            value={elem.value}
                            onChange={(ev: any) => modifyElement(i, elem.key, ev.target.value)}
                            leadingVisual={props.valueIcon}
                            disabled={props.disabled}
                            readOnly={props.disabled}
                        />
                    </div>))}
            </div>
        </div>
    );
};

export function flattenKeyValueList(list: KeyValueListElement[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const kv of list) {
        out[kv.key] = kv.value;
    }
    return out;
}
