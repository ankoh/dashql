import {
    DockerContainerSummary,
    DockerCreateContainerSpec,
    DockerImageTagPage,
    DockerLogChunk,
    DockerPullProgress,
} from "./docker_types.js";

export interface DockerClient {
    /// List containers, optionally filtered by a label key (value-agnostic).
    listContainers(labelKey?: string): Promise<DockerContainerSummary[]>;
    /// Start a container by id.
    startContainer(id: string): Promise<void>;
    /// Stop a container by id.
    stopContainer(id: string): Promise<void>;
    /// Remove a container by id; force=true also kills running.
    removeContainer(id: string, force: boolean): Promise<void>;
    /// Create a container; returns the new id.
    createContainer(spec: DockerCreateContainerSpec, name?: string): Promise<string>;
    /// Pull an image, yielding progress events.
    pullImage(repository: string, tag: string, signal?: AbortSignal): AsyncIterable<DockerPullProgress>;
    /// Stream logs for a container until cancelled.
    streamLogs(containerId: string, signal?: AbortSignal): AsyncIterable<DockerLogChunk>;
    /// List tags for a repository, paginated.
    listImageTags(repository: string, signal?: AbortSignal): AsyncIterable<DockerImageTagPage>;
}
