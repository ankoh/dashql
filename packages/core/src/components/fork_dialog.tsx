import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, Button, Dropdown, DropdownButton, ButtonGroup } from 'react-bootstrap';

import styles from './fork_dialog.module.css';

import icon_github from '../../static/svg/icons/github.svg';
import icon_copy from '../../static/svg/icons/file_multiple.svg';
import { useActiveGitHubProfile } from '../github';
import {
    forkLocal,
    REPLACE_PROGRAM,
    SAVE_SCRIPT,
    useProgramContext,
    useProgramContextDispatch,
    useScriptRegistry,
    useScriptRegistryDispatch,
} from '../model';
import { useOverlaySetter } from './overlay';

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
                        <Form.Switch label="Enable DashQL Analytics" defaultChecked={true} disabled />
                        <Form.Switch label="Public Dashboard Statistics" defaultChecked={true} disabled />
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
        default:
            console.assert(false);
            return <div />;
    }
};

interface DialogProps {
    onClose: () => void;
}

export const ForkDialog: React.FC<DialogProps> = (_props: DialogProps) => {
    const scriptRegistry = useScriptRegistry();
    const programCtx = useProgramContext();
    const programCtxDispatch = useProgramContextDispatch();
    const scriptRegistryDispatch = useScriptRegistryDispatch();
    const setOverlay = useOverlaySetter();
    const [forkTarget, setForkTarget] = React.useState<ForkTargetType | null>(null);

    const forkScriptLocal = React.useCallback(() => {
        const script = forkLocal(scriptRegistry, programCtx.script);
        scriptRegistryDispatch({
            type: SAVE_SCRIPT,
            data: script,
        });
        programCtxDispatch({
            type: REPLACE_PROGRAM,
            data: [programCtx.program, script],
        });
    }, [setOverlay]);

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
                    <div key="config" className={styles.fork_target_config}>
                        {(forkTarget == null || forkTarget == ForkTargetType.GITHUB_GIST) && (
                            <div
                                key="gist"
                                className={styles.fork_target_type}
                                onClick={() => setForkTarget(s => (s != null ? null : ForkTargetType.GITHUB_GIST))}
                            >
                                <svg className={styles.fork_target_type_icon} width="28px" height="28px">
                                    <use xlinkHref={`${icon_github}#sym`} />
                                </svg>
                                {forkTarget == null && <div className={styles.fork_target_type_name}>GitHub Gist</div>}
                            </div>
                        )}
                        {forkTarget == null && (
                            <div key="local" className={styles.fork_target_type}>
                                <svg className={styles.fork_target_type_icon} width="20px" height="20px">
                                    <use xlinkHref={`${icon_copy}#sym`} />
                                </svg>
                                {forkTarget == null && (
                                    <div className={styles.fork_target_type_name} onClick={forkScriptLocal}>
                                        Local File
                                    </div>
                                )}
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
