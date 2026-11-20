// The downloads of an architecture diagram as SVG and PNG. The file stands on its own: the colors of the theme are
// frozen into presentation attributes and the fonts are embedded, an SVG editor opens it without the page.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const PRESENTATION_PROPERTIES = [
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-linecap',
    'stroke-linejoin',
    'opacity',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'letter-spacing',
    'text-anchor',
    'dominant-baseline',
    'text-decoration',
    'marker-start',
    'marker-mid',
    'marker-end',
];
/// The PNG has twice the pixels of the view box
const PNG_SCALE = 2;

function blobDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/// The @font-face rules of the page for the family and the weights that the diagram uses, with the fonts as data URLs
async function embeddedFonts(family: string, weights: Set<string>): Promise<string> {
    const fonts: Promise<string>[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            // A stylesheet of another origin hides its rules
            continue;
        }
        for (const rule of Array.from(rules)) {
            if (!(rule instanceof CSSFontFaceRule)) continue;
            const css = rule.cssText;
            const name = css
                .match(/font-family:\s*([^;}]+)/)?.[1]
                .replace(/["']/g, '')
                .trim();
            const weight = css.match(/font-weight:\s*([^;}]+)/)?.[1].trim() ?? '400';
            if (!name || !family.includes(name) || !weights.has(weight)) continue;
            fonts.push(
                (async () => {
                    let embedded = css;
                    for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
                        const response = await fetch(new URL(match[1], sheet.href ?? document.baseURI));
                        if (!response.ok) throw new Error('Could not load the font of the diagram.');
                        embedded = embedded.replace(match[0], `url("${await blobDataUrl(await response.blob())}")`);
                    }
                    return embedded;
                })(),
            );
        }
    }
    return (await Promise.all(fonts)).join('\n');
}

async function svgBlob(svg: SVGSVGElement): Promise<Blob> {
    await document.fonts.ready;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    const sources = [svg, ...Array.from(svg.querySelectorAll('*'))];
    const targets = [copy, ...Array.from(copy.querySelectorAll('*'))];
    const weights = new Set<string>();

    // The computed styles become presentation attributes of the copy, the classes of the page go. The ids stay, they
    // name the layers of the cards in an SVG editor.
    for (const [index, source] of sources.entries()) {
        const computed = getComputedStyle(source);
        const target = targets[index];
        for (const property of PRESENTATION_PROPERTIES) {
            const value = computed.getPropertyValue(property === 'text-decoration' ? 'text-decoration-line' : property);
            // A marker is url("https://dashql.org/architecture#id") in the computed style, the file names it by its id
            if (value) target.setAttribute(property, value.replace(/url\(["']?[^)"']*#([^)"']+)["']?\)/g, 'url(#$1)'));
        }
        if (source.tagName === 'text' || source.tagName === 'tspan') weights.add(computed.fontWeight);
        target.removeAttribute('class');
    }

    const fonts = await embeddedFonts(getComputedStyle(svg).fontFamily, weights);
    if (fonts) {
        const style = document.createElementNS(SVG_NAMESPACE, 'style');
        style.textContent = fonts;
        copy.querySelector('defs')?.append(style);
    }
    return new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml;charset=utf-8' });
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadSvg(svg: SVGSVGElement, filename: string): Promise<void> {
    downloadBlob(await svgBlob(svg), filename);
}

export async function downloadPng(svg: SVGSVGElement, filename: string): Promise<void> {
    const source = URL.createObjectURL(await svgBlob(svg));
    try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('Could not render the diagram.'));
            image.src = source;
        });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(svg.viewBox.baseVal.width * PNG_SCALE);
        canvas.height = Math.round(svg.viewBox.baseVal.height * PNG_SCALE);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create the PNG.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the PNG.'))), 'image/png');
        });
        downloadBlob(png, filename);
    } finally {
        URL.revokeObjectURL(source);
    }
}
