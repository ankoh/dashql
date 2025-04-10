import * as React from 'react';
import * as styles from './value_list.module.css';

import { PlusIcon, XIcon } from '@primer/octicons-react';

import { Dispatch } from '../../utils/variant.js';
import { classNames } from '../../utils/classnames.js';
import { TextInput } from './text_input.js';
import { TextInputAction } from './text_input_action.js';
import { ButtonSize, IconButton } from './button.js';

export type ValueListElement = string;

export type UpdateValueList = (prev: ValueListElement[]) => ValueListElement[];

interface Props {
    className?: string;
    title: string;
    caption?: string;
    valueIcon: React.ElementType;
    addButtonLabel: string;
    elements: ValueListElement[];
    modifyElements: Dispatch<UpdateValueList>;
    disabled?: boolean;
    readOnly?: boolean;
}

export const ValueListBuilder: React.FC<Props> = (props: Props) => {
    const appendElement = () => props.modifyElements(list => {
        const copy = [...list];
        copy.push("");
        return copy;
    });
    const deleteIndex = (index: number) => props.modifyElements(list => {
        const copy = [...list];
        copy.splice(index, 1);
        return copy;
    });
    const modifyElement = (index: number, value: string) => props.modifyElements(list => {
        const copy = [...list];
        copy[index] = value;
        return copy;
    });

    return (
        <div className={classNames(props.className, styles.list)}>
            <div className={styles.list_name}>
                {props.title}
            </div>
            {props.caption && (
                <div className={styles.list_caption}>
                    {props.caption}
                </div>
            )}
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
                            value={elem}
                            onChange={(ev: any) => modifyElement(i, ev.target.value)}
                            leadingVisual={props.valueIcon}
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
                    </div>))}
            </div>
        </div>
    );
};
