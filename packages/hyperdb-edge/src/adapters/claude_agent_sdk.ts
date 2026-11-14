// The tools of hyperdb-edge for the Claude Agent SDK, as an MCP server in the process of the application.
// @anthropic-ai/claude-agent-sdk and zod are peer dependencies of this module only.

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { EdgeTool, JsonObjectSchema, JsonSchemaProperty } from '../tools.js';

/// The name of the server unless the application gives another; the tools are mcp__hyperdb__run_sql and
/// mcp__hyperdb__describe
export const DEFAULT_SERVER_NAME = 'hyperdb';

function zodType(property: JsonSchemaProperty, required: boolean): z.ZodType {
    let type: z.ZodType;
    if (property.enum != null) {
        type = z.enum(property.enum as [string, ...string[]]);
    } else if (property.type === 'integer') {
        let integer = z.number().int();
        if (property.minimum != null) integer = integer.min(property.minimum);
        type = integer;
    } else {
        type = z.string();
    }
    type = type.describe(property.description);
    return required ? type : type.optional();
}

function zodShape(schema: JsonObjectSchema): Record<string, z.ZodType> {
    return Object.fromEntries(
        Object.entries(schema.properties).map(([name, property]) => [name, zodType(property, schema.required.includes(name))]),
    );
}

/// The names of the tools as the Agent SDK knows them, for allowedTools
export function agentSdkToolNames(tools: readonly EdgeTool[], serverName = DEFAULT_SERVER_NAME): string[] {
    return tools.map(edgeTool => `mcp__${serverName}__${edgeTool.name}`);
}

/// The tools as an MCP server of the Agent SDK, to pass to query() as mcpServers: { [serverName]: server }.
/// - readOnlyHint lets the SDK run describe alongside other tools, run_sql never runs alongside another call.
/// - alwaysLoad keeps the schemas in the first request, the SDK otherwise defers them behind tool search.
/// - The result is text in content without structuredContent, which would hide the text from the model.
export function agentSdkServer(tools: readonly EdgeTool[], serverName = DEFAULT_SERVER_NAME) {
    return createSdkMcpServer({
        name: serverName,
        version: '0.0.0',
        tools: tools.map(edgeTool =>
            tool(
                edgeTool.name,
                edgeTool.description,
                zodShape(edgeTool.inputSchema),
                async (args, extra) => {
                    // The extra of a call of the MCP server carries the signal that cancels it
                    const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
                    const result = await edgeTool.run(args, signal);
                    return { content: [{ type: 'text' as const, text: result.text }], isError: result.isError };
                },
                { annotations: { readOnlyHint: edgeTool.readOnly }, alwaysLoad: true },
            ),
        ),
    });
}
