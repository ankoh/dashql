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

/// Build the prompt of a question for the agent. The guide of `dashql guide` is in the instructions of the harness, the
/// prompt only adds the question and how to answer it.
export function buildAgentPrompt(input: AgentPromptInput): string {
    const lines = [
        'Answer the question below on the DashQL workbook, through the `dashql` commands only.',
        `New scripts run on a connection that speaks ${input.dialect} unless you name another.`,
        'Start with `dashql scripts`, look up tables with `dashql catalog`.',
        'When the question asks for data, answer it in the scripts: write a query with `dashql edit <script>`, into a new'
            + ' script with a short snake_case name unless the question is about an existing script, then run it with'
            + ' `dashql run <script>`.',
        'When the question asks for an explanation, e.g. of a script, a result or an error, read what you need and answer'
            + ' in text, change scripts only if the question asks for it.',
        'The user watches the scripts change and run and sees what you say between your steps: keep that to a short'
            + ' sentence, do not recap your steps, the queries or the results.',
        'End with your answer in Markdown: one sentence when the results already show the data, a few short paragraphs or'
            + ' a list for an explanation. No headings, no tables of results.',
    ];
    if (input.referencedScripts.length > 0) {
        lines.push(`The question targets these scripts, referenced as ${renderScriptReference('<script>')}: ${input.referencedScripts.join(', ')}.`
            + ' Work on them instead of writing a new script.');
    }
    // Harnesses reject NUL characters
    lines.push('', 'Question:', input.question.replace(/\0/g, ''));
    return lines.join('\n');
}
