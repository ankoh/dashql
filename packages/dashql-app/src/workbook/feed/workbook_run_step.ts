import type { WorkbookRunStep } from '@akohn/dashql';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';

/// The step of a run before its statements run, short for the status of Execute All
export function runStepLabel(step: WorkbookRunStep): string {
    switch (step.type) {
        case 'analyzing':
            return 'Analyzing...';
        case 'planning':
            return 'Planning...';
        case 'checking':
            return `Checking ${scriptDisplayName(step.fileName)}...`;
        case 'reading':
            return `Reading ${scriptDisplayName(step.fileName)}...`;
        case 'connecting':
            return 'Connecting...';
        case 'mountingAttachments':
            return 'Mounting attachments...';
        case 'mountingResults':
            return 'Mounting results...';
    }
}

/// The step of a run before its statements run as the status bar tells it, with the names of the connections
export function runStepText(step: WorkbookRunStep, connectionName: (connectionId: string) => string): string {
    switch (step.type) {
        case 'analyzing':
            return 'Analyzing the scripts';
        case 'planning':
            return 'Planning the run of all scripts';
        case 'checking':
            return `Looking up the stored result of ${scriptDisplayName(step.fileName)}`;
        case 'reading':
            return `Reading the stored result of ${scriptDisplayName(step.fileName)}`;
        case 'connecting':
            return `Connecting to ${step.connectionIds.map(connectionName).join(', ')}`;
        case 'mountingAttachments':
            return 'Mounting the attachments of the workbook';
        case 'mountingResults':
            return 'Mounting the stored results';
    }
}
