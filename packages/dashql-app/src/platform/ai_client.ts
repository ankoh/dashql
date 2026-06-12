import { HttpClient } from "./http/http_client.js";
import { Logger } from "./logger/logger.js";
import { AIProviderHeader } from "../app_config.js";

/// Resolved (non-optional) provider settings used by the client.
export interface AIClientSettings {
    endpointUrl: string;
    model: string;
    headers: AIProviderHeader[];
}

const LOG_CTX = "ai_client";

interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

interface ChatCompletionResponse {
    choices?: { message?: { content?: string } }[];
}

interface ListModelsResponse {
    data?: { id?: string }[];
}

function joinUrl(base: string, path: string): URL {
    const trimmed = base.replace(/\/+$/, "");
    return new URL(trimmed + path);
}

function buildHeaders(extra: AIProviderHeader[]): Record<string, string> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    };
    for (const h of extra) {
        if (h.name) headers[h.name] = h.value;
    }
    return headers;
}

/// An AI client speaking the OpenAI-compatible chat completions REST API.
/// Works with OpenAI, Ollama (/v1/* compat layer), vLLM, llama.cpp, etc.
export class AIClient {
    logger: Logger;
    httpClient: HttpClient;
    settings: AIClientSettings;

    constructor(logger: Logger, httpClient: HttpClient, settings: AIClientSettings) {
        this.logger = logger;
        this.httpClient = httpClient;
        this.settings = settings;
    }

    /// List available models. Used for the Test button in AI settings.
    async listModels(signal: AbortSignal): Promise<string[]> {
        const url = joinUrl(this.settings.endpointUrl, "/v1/models");
        this.logger.debug("Listing AI models", { url: url.toString() }, LOG_CTX);
        const response = await this.httpClient.fetch(url, {
            method: "GET",
            headers: buildHeaders(this.settings.headers),
            signal,
        });
        if (response.status < 200 || response.status >= 300) {
            const body = await response.text();
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 200)}`);
        }
        const parsed = (await response.json()) as ListModelsResponse;
        const ids: string[] = [];
        for (const m of parsed.data ?? []) {
            if (typeof m.id === "string") ids.push(m.id);
        }
        return ids;
    }

    /// Generate a completion for a single user prompt.
    async generate(prompt: string, signal: AbortSignal): Promise<string> {
        const url = joinUrl(this.settings.endpointUrl, "/v1/chat/completions");
        const messages: ChatMessage[] = [{ role: "user", content: prompt }];
        const body = JSON.stringify({
            model: this.settings.model,
            messages,
            stream: false,
        });
        this.logger.debug("Calling AI chat completion", { url: url.toString(), model: this.settings.model }, LOG_CTX);
        const response = await this.httpClient.fetch(url, {
            method: "POST",
            headers: buildHeaders(this.settings.headers),
            body,
            signal,
        });
        if (response.status < 200 || response.status >= 300) {
            const errBody = await response.text();
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${errBody.slice(0, 200)}`);
        }
        const parsed = (await response.json()) as ChatCompletionResponse;
        const content = parsed.choices?.[0]?.message?.content ?? "";
        this.logger.debug("Received AI chat completion", { length: String(content.length) }, LOG_CTX);
        return content;
    }
}
