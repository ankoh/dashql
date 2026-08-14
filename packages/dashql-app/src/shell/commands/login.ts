import type { DashQLShellCommand } from '../api.js';

export const LOGIN_UNAVAILABLE_MESSAGE = 'Salesforce authentication is not available in this build yet.';

export const loginCommand: DashQLShellCommand = [
    'login',
    'Authenticate with Salesforce',
    () => LOGIN_UNAVAILABLE_MESSAGE,
];
