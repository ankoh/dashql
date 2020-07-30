import type Monaco from 'monaco-editor';

const monaco: typeof Monaco = process.browser
    ? require('monaco-editor')
    : undefined;

export default monaco;

export type { Monaco };
