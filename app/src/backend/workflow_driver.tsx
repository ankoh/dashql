import React, { ReactElement } from 'react';
import * as model from '../model';
import { useWorkflowSession, useWorkflowSessionState } from './workflow_session';

type Props = {
    children: React.ReactElement | ReactElement[];
};

export const WorkflowDriver: React.FC<Props> = (props: Props) => {
    const workflowSession = useWorkflowSession();
    const workflowSessionState = useWorkflowSessionState();
    const executed = React.useRef<model.ProgramAnalysis>(null);

    // Execute the program (if it changes)
    React.useEffect(() => {
        if (workflowSession == null) {
            return;
        }
        if (executed.current !== workflowSession.uncommittedState.programAnalysis) {
            executed.current = workflowSession.uncommittedState.programAnalysis;
            console.log('EXECUTE');
            workflowSession.executeProgram();
        }
    }, [workflowSession, workflowSessionState]);

    return <>{props.children}</>;
};
