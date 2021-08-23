import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, Button, Dropdown, DropdownButton, ButtonGroup } from 'react-bootstrap';

import styles from './fork_dialog.module.css';

import icon_github from '../../static/svg/icons/github.svg';
import icon_copy from '../../static/svg/icons/file_multiple.svg';
import { useActiveGitHubProfile } from '../github';

enum ForkTargetType {
    GITHUB_GIST,
    LOCAL_FILE,
}

interface FormProps {
    type: ForkTargetType;
    className?: string;
}

const ForkDetailForm: React.FC<FormProps> = (props: FormProps) => {
    const ghProfile = useActiveGitHubProfile();
    switch (props.type) {
        case ForkTargetType.GITHUB_GIST:
            if (ghProfile == null) {
                return (
                    <div key="description" className={styles.detail_text}>
                        Please log into your GitHub account first.
                    </div>
                );
            }
            return (
                <Form className={props.className}>
                    <Form.Group className="mb-2" controlId="formFileName">
                        <Form.Control type="text" placeholder="Enter file name" />
                    </Form.Group>
                    <Form.Group className="mb-3" controlId="formBasicCheckbox">
                        <Form.Check type="checkbox" label="Enable DashQL Analytics" defaultChecked={true} disabled />
                        <Form.Check
                            type="checkbox"
                            label="Public Dashboard Statistics"
                            defaultChecked={true}
                            disabled
                        />
                    </Form.Group>
                    <ButtonGroup>
                        <Button>Create secret gist</Button>
                        <DropdownButton as={ButtonGroup} title="" id="bg-nested-dropdown">
                            <Dropdown.Item eventKey="1">Create secret gist</Dropdown.Item>
                            <Dropdown.Item eventKey="2">Create public gist</Dropdown.Item>
                        </DropdownButton>
                    </ButtonGroup>
                </Form>
            );
        case ForkTargetType.LOCAL_FILE:
            return (
                <Form className={props.className}>
                    <Form.Group className="mb-2" controlId="formFileName">
                        <Form.Control type="text" placeholder="Enter file name" />
                    </Form.Group>
                    <Button>Create file</Button>
                </Form>
            );
    }
};

interface DialogProps {
    onClose: () => void;
}

export const ForkDialog: React.FC<DialogProps> = (_props: DialogProps) => {
    const [forkTarget, setForkTarget] = React.useState<ForkTargetType | null>(null);

    return (
        <AnimatePresence>
            <motion.div
                className={styles.container}
                initial={{ translateY: 20 }}
                animate={{ translateY: 0 }}
                onClick={e => e.stopPropagation()}
            >
                <div className={styles.header}>Fork Script</div>
                <div className={styles.body}>
                    {forkTarget == null && (
                        <div key="description" className={styles.description}>
                            Select a fork destination
                        </div>
                    )}
                    <div key="config" className={styles.fork_target_config}>
                        {(forkTarget == null || forkTarget == ForkTargetType.GITHUB_GIST) && (
                            <div
                                key="gist"
                                className={styles.fork_target_type}
                                onClick={() => setForkTarget(s => (s != null ? null : ForkTargetType.GITHUB_GIST))}
                            >
                                <svg width="28px" height="28px">
                                    <use xlinkHref={`${icon_github}#sym`} />
                                </svg>
                            </div>
                        )}
                        {(forkTarget == null || forkTarget == ForkTargetType.LOCAL_FILE) && (
                            <div
                                key="local"
                                className={styles.fork_target_type}
                                onClick={() => setForkTarget(s => (s != null ? null : ForkTargetType.LOCAL_FILE))}
                            >
                                <svg width="20px" height="20px">
                                    <use xlinkHref={`${icon_copy}#sym`} />
                                </svg>
                            </div>
                        )}
                        {forkTarget != null && (
                            <div className={styles.fork_target_detail}>
                                <ForkDetailForm type={forkTarget} />
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};
