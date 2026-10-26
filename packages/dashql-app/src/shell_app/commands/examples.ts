import type { DashQLShellCommand } from '../../shell/api.js';

export interface ExamplesCommandDependencies {
    /// Browse the snippets, resolves with the text of the used snippet or null if none was used
    requestSnippet(signal?: AbortSignal): Promise<string | null>;
    /// Split the text of a snippet into the prompts of its statements
    splitPrompts(text: string): string[];
    /// Offer the prompts one after another, each submit fills in the next one
    queuePrompts(prompts: readonly string[]): void;
}

export function createExamplesCommand(dependencies: ExamplesCommandDependencies): DashQLShellCommand {
    return [
        'examples',
        'Browse example SQL snippets',
        async (args, context) => {
            if (args.length !== 0) throw new Error('usage: .examples');
            if (context.signal?.aborted) return;
            const text = await dependencies.requestSnippet(context.signal);
            if (text == null || context.signal?.aborted) return;
            const prompts = dependencies.splitPrompts(text);
            if (prompts.length === 0) return;
            dependencies.queuePrompts(prompts);
            if (prompts.length > 1) {
                return `Inserted ${prompts.length} statements. Press Enter to run each, Ctrl+C to skip the rest.`;
            }
        },
    ];
}
