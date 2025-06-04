import { HttpClient } from "./http_client.js";
import { Logger } from "./logger.js";

const LOG_CTX = "ollama";

/// An Ollama client
export class OllamaClient {
    logger: Logger;
    httpClient: HttpClient;

    constructor(logger: Logger, httpClient: HttpClient) {
        this.logger = logger;
        this.httpClient = httpClient;
    }

    async generate(model: string, prompt: string, cancel: AbortSignal): Promise<string> {
        const pipeToConsole = true;
        this.logger.debug("calling ollama", { model, prompt }, LOG_CTX, pipeToConsole);
        const response = await this.httpClient.fetch(new URL("http://localhost:11434/api/generate"), {
            method: 'POST',
            body: JSON.stringify({
                model,
                prompt
            }),
            signal: cancel
        });
        this.logger.debug("received ollama result", {}, LOG_CTX, pipeToConsole);
        const responseText = await response.text();
        const responseLines = responseText.split("\n");
        let responseMessages: any[] = [];
        for (const line of responseLines) {
            try {
                responseMessages.push(JSON.parse(line));
            } catch (e: any) { }
        }
        this.logger.debug("parsed ollama result", {}, LOG_CTX, pipeToConsole);

        let combinedResponse = "";
        for (const msg of responseMessages) {
            const chunk = msg.response;
            if (chunk != undefined) {
                combinedResponse += chunk;
            }
        }

        this.logger.debug("combined chunks", { text: combinedResponse }, LOG_CTX, pipeToConsole);

        /// XXX Hacky hack
        const pattern = '</think>\n';
        const idx = combinedResponse.lastIndexOf(pattern);
        const cleanedResponse = idx !== -1 ? combinedResponse.slice(idx + pattern.length) : combinedResponse;

        this.logger.debug("removed preamble", { text: cleanedResponse }, LOG_CTX, pipeToConsole);
        return cleanedResponse;
    }
}
