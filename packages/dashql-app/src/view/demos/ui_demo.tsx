import * as React from 'react';
import * as ActionList from '../foundations/action_list.js'
import * as styles from './ui_demo.module.css';

import {
    ChecklistIcon,
    CopyIcon,
    EyeIcon,
    HeartIcon,
    PaperAirplaneIcon,
    TriangleDownIcon,
} from '@primer/octicons-react';

import { TextInput, TextInputValidationStatus } from '../foundations/text_input.js';
import { TextInputAction } from '../foundations/text_input_action.js';
import { Button, ButtonSize, ButtonVariant } from '../foundations/button.js';

export function UIExperimentPage(): React.ReactElement {
    return <div className={styles.root}>
        <div className={styles.component_section}>
            <div className={styles.component_section_header}>
                UI Design System
            </div>
            <div className={styles.component}>
                <div className={styles.component_title}>
                    Text Input
                </div>
                <div className={styles.component_variants}>
                    <TextInput />
                    <TextInput value="some value" onChange={() => { }} />
                    <TextInput value="looooooooooooooooooooooooooooooooooooooooooong" onChange={() => { }} />
                    <TextInput placeholder="some placeholder" />
                    <TextInput disabled />
                    <TextInput disabled placeholder="some placeholder" />
                    <TextInput validationStatus={TextInputValidationStatus.Success} value="abc" onChange={() => { }} />
                    <TextInput validationStatus={TextInputValidationStatus.Error} />
                    <TextInput block />
                    <TextInput
                        leadingVisual={() => <div>URL</div>}
                    />
                    <TextInput
                        leadingVisual={ChecklistIcon}
                    />
                    <TextInput
                        trailingVisual={ChecklistIcon}
                    />
                    <TextInput
                        leadingVisual={ChecklistIcon}
                        trailingVisual={ChecklistIcon}
                    />
                    <TextInput
                        trailingAction={
                            <TextInputAction
                                onClick={() => { }}
                                aria-label="action"
                                aria-labelledby=""
                            >
                                <CopyIcon />
                            </TextInputAction>
                        }
                    />
                    <TextInput
                        leadingVisual={ChecklistIcon}
                        trailingVisual={ChecklistIcon}
                        trailingAction={
                            <TextInputAction
                                onClick={() => { }}
                                aria-label="action"
                                aria-labelledby=""
                            >
                                <CopyIcon />
                            </TextInputAction>
                        }
                    />
                </div>
            </div>
            <div className={styles.component}>
                <div className={styles.component_title}>
                    Button
                </div>
                <div className={styles.component_variants}>
                    <Button>Default</Button>
                    <Button disabled>Default</Button>
                    <Button variant={ButtonVariant.Primary}>Primary</Button>
                    <Button variant={ButtonVariant.Primary} disabled>Primary</Button>
                    <Button variant={ButtonVariant.Danger}>Danger</Button>
                    <Button variant={ButtonVariant.Danger} disabled>Danger</Button>
                    <Button variant={ButtonVariant.Invisible}>Invisible</Button>
                    <Button variant={ButtonVariant.Invisible} disabled>Invisible</Button>
                    <Button leadingVisual={HeartIcon}>Leading Visual</Button>
                    <Button trailingVisual={EyeIcon}>Trailing Visual</Button>
                    <Button trailingAction={<TriangleDownIcon />}>Trailing action</Button>
                    <Button block>Block</Button>
                    <Button size={ButtonSize.Small}>Small</Button>
                    <Button size={ButtonSize.Medium}>Medium</Button>
                    <Button size={ButtonSize.Large}>Large</Button>
                </div>
                <div className={styles.component}>
                    <div className={styles.component_title}>
                        Action List
                    </div>
                    <div className={styles.component_variants}>
                        <div className={styles.actionlist_component}>
                            <ActionList.List aria-label="Sessions" leading trailing>
                                <ActionList.GroupHeading>
                                    Sessions
                                </ActionList.GroupHeading>
                                <ActionList.ListItem>
                                    <ActionList.Leading>
                                        <PaperAirplaneIcon />
                                    </ActionList.Leading>
                                    <ActionList.ItemText>
                                        Execute Query
                                    </ActionList.ItemText>
                                    <ActionList.Trailing>
                                        Ctrl + E
                                    </ActionList.Trailing>
                                </ActionList.ListItem>
                                <ActionList.ListItem>
                                    <ActionList.Leading>
                                        <EyeIcon />
                                    </ActionList.Leading>
                                    <ActionList.ItemText>
                                        Execute Query
                                    </ActionList.ItemText>
                                    <ActionList.Trailing>
                                        Ctrl + E
                                    </ActionList.Trailing>
                                </ActionList.ListItem>
                            </ActionList.List>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>;

}
