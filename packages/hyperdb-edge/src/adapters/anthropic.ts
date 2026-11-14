// The tools of hyperdb-edge for the Tool Runner of the Anthropic SDK (client.beta.messages.toolRunner).
// @anthropic-ai/sdk is a peer dependency of this module only.

import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { ToolError } from '@anthropic-ai/sdk/lib/tools/ToolError';

import type { EdgeTool } from '../tools.js';

/// The tools as runnable tools of the Tool Runner. A failing call becomes a tool result with is_error, the text of
/// hyperdb-edge as its content; the signal of the runner cancels the running statement.
export function anthropicTools(tools: readonly EdgeTool[]) {
    return tools.map(tool =>
        betaTool({
            name: tool.name,
            description: tool.description,
            // The schema is a plain object, betaTool infers the type of the input from a literal only
            inputSchema: tool.inputSchema as unknown as { type: 'object'; properties: Record<string, never> },
            run: async (input, context) => {
                const result = await tool.run(input, context?.signal ?? undefined);
                if (result.isError) throw new ToolError(result.text);
                return result.text;
            },
        }),
    );
}
