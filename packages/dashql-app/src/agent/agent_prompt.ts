import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { renderScriptReference } from './agent_script_references.js';

/// Describe the SQL dialect of a connector for the agent
export function describeSqlDialect(connectorType: ConnectorType | null): string {
    switch (connectorType) {
        case ConnectorType.SALESFORCE_DATA_CLOUD:
        case ConnectorType.DBCOM:
            return 'Salesforce Data Cloud SQL (PostgreSQL-compatible)';
        case ConnectorType.TRINO:
            return 'Trino';
        default:
            return 'Tableau Hyper (PostgreSQL-compatible)';
    }
}

/// A question that the agent answers in the scripts of a workbook
export interface AgentPromptInput {
    /// The question in natural language
    question: string;
    /// The SQL dialect of the connection of the next script
    dialect: string;
    /// The scripts that the question references, by their display names
    referencedScripts: string[];
}

/// Build the prompt of a question for the agent: the question with what only the page knows of it. The guide of
/// `dashql guide`, in the instructions of the harness, holds the rules of the work.
export function buildAgentPrompt(input: AgentPromptInput): string {
    const scripts = input.referencedScripts;
    const targets = scripts.length === 0
        ? ''
        : ` The question targets these scripts, referenced as ${renderScriptReference('<script>')}: ${scripts.join(', ')}. Work on them instead of writing a new script.`;
    // Harnesses reject NUL characters
    return `New scripts run on a connection that speaks ${input.dialect} unless you name another.${targets}

Question:
${input.question.replace(/\0/g, '')}`;
}
