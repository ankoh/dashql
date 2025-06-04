import { HttpClient } from "./http_client.js";


/// An Ollama client
export class OllamaClient {
    httpClient: HttpClient;

    constructor(httpClient: HttpClient) {
        this.httpClient = httpClient;
    }

    async generate(model: string, prompt: string): Promise<string> {
        return "42";
    }
}
