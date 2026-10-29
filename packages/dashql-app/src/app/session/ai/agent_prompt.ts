import { ConnectorType } from '../../connections/connector_info.js';

/// Describe the SQL dialect of a connector for the agent
export function describeSqlDialect(connectorType: ConnectorType): string {
    switch (connectorType) {
        case ConnectorType.HYPER:
            return 'Tableau Hyper (PostgreSQL-compatible)';
        case ConnectorType.SALESFORCE_DATA_CLOUD:
        case ConnectorType.SIDB:
            return 'Salesforce Data Cloud SQL (PostgreSQL-compatible)';
        case ConnectorType.TRINO:
            return 'Trino';
    }
}

/// A question that the agent answers in the scripts of a session
export interface AgentPromptInput {
    /// The question in natural language
    question: string;
    /// The SQL dialect of the connection
    dialect: string;
    /// The catalog objects that the question mentions, e.g. "orders (table)"
    mentionedIdentifiers: string[];
    /// The scripts that the question references, by their display names
    referencedScripts: string[];
}

/// Build the prompt of a question for the agent.
/// The agent reads the schema and writes the SQL itself through the dashql command, it also picks the script.
export function buildAgentPrompt(input: AgentPromptInput): string {
    const lines = [
        'Answer the question below with a SQL query in a DashQL script.',
        `The connection speaks ${input.dialect}.`,
        'Look up the scripts with `dashql agent scripts` and the schema with `dashql agent catalog`.',
        'Write the query with `dashql agent edit <script>`, into a new script with a short snake_case name'
            + ' unless the question is about an existing script.',
        'Check it with `dashql agent lint <script>` and run it with `dashql agent run <script>`.',
        'Prefer read-only queries.',
        'The user watches the scripts change and run, do not recap your steps, the queries or the results.',
        'End with one plain sentence without markdown that answers the question, or with nothing if the results'
            + ' already answer it.',
    ];
    if (input.referencedScripts.length > 0) {
        lines.push(`The question targets these scripts, referenced as @<script>: ${input.referencedScripts.join(', ')}.`
            + ' Work on them instead of writing a new script.');
    }
    if (input.mentionedIdentifiers.length > 0) {
        lines.push(`The question mentions these catalog objects: ${input.mentionedIdentifiers.join(', ')}.`);
    }
    // Harnesses reject NUL characters
    lines.push('', 'Question:', input.question.replace(/\0/g, ''));
    return lines.join('\n');
}
