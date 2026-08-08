export interface ShellCommandContext {
    clearEntries: () => void;
    openCatalog: (target: 'relations' | 'functions') => void;
    refreshCatalog: () => string | null;
    openConnection: () => void;
    showNotebook: () => void;
}

export interface ShellCommand {
    name: string;
    description: string;
    forms: readonly ShellCommandForm[];
    execute: (args: readonly string[], context: ShellCommandContext) => string | null;
}

export interface ShellCommandForm {
    args: readonly string[];
    description: string;
}

export interface ShellCommandCompletion {
    label: string;
    description: string;
}

export interface ParsedShellCommand {
    name: string;
    args: string[];
}

const SHELL_COMMANDS: ReadonlyMap<string, ShellCommand> = new Map([
    ['clear', {
        name: 'clear',
        description: 'Clear the Shell output',
        forms: [{ args: [], description: 'Clear the Shell output' }],
        execute: (_args, context) => {
            context.clearEntries();
            return null;
        },
    }],
    ['catalog', {
        name: 'catalog',
        description: 'Open or refresh the connection catalog',
        forms: [
            { args: ['relations'], description: 'Open catalog relations' },
            { args: ['functions'], description: 'Open catalog functions' },
            { args: ['refresh'], description: 'Refresh the connection catalog' },
        ],
        execute: (args, context) => {
            switch (args[0]?.toLowerCase()) {
                case 'relations':
                    context.openCatalog('relations');
                    return null;
                case 'functions':
                    context.openCatalog('functions');
                    return null;
                case 'refresh':
                    return context.refreshCatalog();
                default:
                    return 'Usage: .catalog relations | functions | refresh';
            }
        },
    }],
    ['connection', {
        name: 'connection',
        description: 'Open connection settings',
        forms: [{ args: [], description: 'Open connection settings' }],
        execute: (_args, context) => {
            context.openConnection();
            return null;
        },
    }],
    ['exit', {
        name: 'exit',
        description: 'Return to Notebook mode',
        forms: [{ args: [], description: 'Return to Notebook mode' }],
        execute: (_args, context) => {
            context.showNotebook();
            return null;
        },
    }],
]);

export function parseShellCommand(text: string): ParsedShellCommand | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('.')) return null;
    const [name = '', ...args] = trimmed.slice(1).split(/\s+/);
    return { name: name.toLowerCase(), args };
}

export function resolveShellCommand(name: string): ShellCommand | null {
    return SHELL_COMMANDS.get(name.toLowerCase()) ?? null;
}

export function executeShellCommand(text: string, context: ShellCommandContext): string | null {
    const parsed = parseShellCommand(text);
    if (parsed == null) return null;
    const command = resolveShellCommand(parsed.name);
    if (command == null) return `Unknown Shell command: .${parsed.name}`;
    return command.execute(parsed.args, context);
}

export function listShellCommands(): readonly ShellCommand[] {
    return [...SHELL_COMMANDS.values()];
}

export function listShellCommandCompletions(): readonly ShellCommandCompletion[] {
    return listShellCommands().flatMap(command => command.forms.map(form => ({
        label: `.${[command.name, ...form.args].join(' ')}`,
        description: form.description,
    })));
}
