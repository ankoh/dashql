// The Work Objects of embed links, see docs/wip/embeds.md.
//
// Everything here is a pure function of the link: the Worker keeps no state, and the same link always gives the same
// entity. Slack matches the entity of entity.presentDetails to the unfurl by its external_ref, so the id is a hash of
// the link.

export type EmbedKind = 'data_file' | 'workbook' | 'hyper_script' | 'embed';

export interface EmbedLink {
    // The kind of embed the parameters select
    kind: EmbedKind;
    // The normalized link, also the preview URL of the side panel
    url: string;
    // The title shown by Slack, plain text
    title: string;
    // The host of a data file
    fileHost?: string;
    // The format of a data file, if the link names one
    fileFormat?: string;
}

const ENTITY_TYPES: Record<EmbedKind, string> = {
    data_file: 'slack#/entities/file',
    workbook: 'slack#/entities/content_item',
    hyper_script: 'slack#/entities/item',
    embed: 'slack#/entities/file',
};

const DISPLAY_TYPES: Record<EmbedKind, string> = {
    data_file: 'Data file',
    workbook: 'Workbook',
    hyper_script: 'Hyper script',
    embed: 'Embed',
};

const FILE_FORMATS = new Set(['parquet', 'csv', 'arrow', 'hyper']);
export const MAX_TITLE_LENGTH = 120;

export const EMBED_MIME_TYPE = 'application/vnd.slack-embed';
export const PRODUCT_NAME = 'DashQL';

// Read an embed link of the app at `appOrigin`, null for any other link
export function parseEmbedLink(link: string, appOrigin: string): EmbedLink | null {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return null;
    }
    if (url.origin !== appOrigin || url.username !== '' || url.password !== '') {
        return null;
    }
    if (url.pathname !== '/embed' && url.pathname !== '/embed.html') {
        return null;
    }
    const href = url.href;
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (fragment.has('script')) {
        return { kind: 'hyper_script', url: href, title: 'Hyper script' };
    }
    const file = url.searchParams.get('file');
    if (file !== null) {
        let fileUrl: URL;
        try {
            fileUrl = new URL(file);
        } catch {
            return null;
        }
        if (fileUrl.protocol !== 'https:') {
            return null;
        }
        const format = url.searchParams.get('format') ?? undefined;
        if (format !== undefined && !FILE_FORMATS.has(format)) {
            return null;
        }
        return {
            kind: 'data_file',
            url: href,
            title: fileTitle(fileUrl),
            fileHost: fileUrl.host,
            fileFormat: format,
        };
    }
    if (url.searchParams.has('zip') || url.searchParams.has('workbook')) {
        return { kind: 'workbook', url: href, title: 'Workbook' };
    }
    return { kind: 'embed', url: href, title: 'DashQL embed' };
}

// The name of a file from the last segment of its path, else its host
function fileTitle(fileUrl: URL): string {
    const segments = fileUrl.pathname.split('/').filter(s => s.length > 0);
    let name = segments.length > 0 ? segments[segments.length - 1] : fileUrl.host;
    try {
        name = decodeURIComponent(name);
    } catch {
        // Keep the encoded name
    }
    return truncate(name, MAX_TITLE_LENGTH);
}

function truncate(text: string, length: number): string {
    return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

// The external_ref id of a link: the first 128 bits of its SHA-256 in hex
export async function entityId(link: EmbedLink): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(link.url));
    return Array.from(new Uint8Array(digest).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}

// The entity of a link. The side panel gets the preview URL, the unfurl only says that there is one.
export async function buildEntity(link: EmbedLink, withPreviewUrl: boolean): Promise<Record<string, unknown>> {
    const customFields: Record<string, unknown>[] = [];
    if (link.fileHost !== undefined) {
        customFields.push({ key: 'source', label: 'Source', value: link.fileHost, type: 'string' });
    }
    if (link.fileFormat !== undefined) {
        customFields.push({ key: 'format', label: 'Format', value: link.fileFormat, type: 'string' });
    }
    const fullSizePreview: Record<string, unknown> = { is_supported: true, mime_type: EMBED_MIME_TYPE };
    if (withPreviewUrl) {
        fullSizePreview.preview_url = link.url;
    }
    const entityPayload: Record<string, unknown> = {
        attributes: {
            title: { text: link.title },
            display_type: DISPLAY_TYPES[link.kind],
            product_name: PRODUCT_NAME,
            full_size_preview: fullSizePreview,
        },
        fields: {},
    };
    if (customFields.length > 0) {
        entityPayload.custom_fields = customFields;
    }
    return {
        entity_type: ENTITY_TYPES[link.kind],
        url: link.url,
        external_ref: { id: await entityId(link), type: link.kind },
        entity_payload: entityPayload,
    };
}
