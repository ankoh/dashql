import React, { ReactElement } from 'react';
import * as model from '../model';
import { useBackend, useBackendResolver } from './backend_provider';
import { useWorkflowData, useWorkflowSession } from './workflow_data_provider';

type Props = {
    children: React.ReactElement | ReactElement[];
};

export const WorkflowDriver: React.FC<Props> = (props: Props) => {
    const workflowData = useWorkflowData();
    const workflowSession = useWorkflowSession();
    const backend = useBackend();
    const backendResolver = useBackendResolver();

    // Resolve backend (if necessary)
    React.useEffect(() => {
        if (backend.value == null && !backend.resolving()) {
            backendResolver();
        }
    }, [backend]);

    // Execute the program (if it changes)
    React.useEffect(() => {
        if (backend.value == null || workflowData.program == null) {
            return;
        }
        console.log('EXECUTE PROGRAM');
        backend.value.workflow.executeProgram(workflowSession);
    }, [backend.value, workflowData.program]);

    return <>{props.children}</>;
};
