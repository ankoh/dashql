import React, { ReactElement } from 'react';
import * as model from '../model';
import { useWorkflowSession, useWorkflowSessionState } from './workflow_session';

type Props = {
    children: React.ReactElement | ReactElement[];
};

export const WorkflowDriver: React.FC<Props> = (props: Props) => {
    const workflowSession = useWorkflowSession();
    const workflowSessionState = useWorkflowSessionState();
    const executed = React.useRef<model.Program>(null);

    // Execute the program (if it changes)
    React.useEffect(() => {
        if (workflowSession == null) {
            return;
        }
        if (executed.current !== workflowSession.uncommittedState.program) {
            executed.current = workflowSession.uncommittedState.program;
            workflowSession.executeProgram();
        }
    }, [workflowSession, workflowSessionState]);

    return <>{props.children}</>;
};
