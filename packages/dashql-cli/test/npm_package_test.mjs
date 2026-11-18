// The package of dashql on npm: its dependencies are the versions that the bundle was built with, and the bundle runs
// as the command of the package
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const read = name => readFileSync(resolve(process.env[name]), 'utf8');

test('depends on @akohn/dashql and the embedded Hyper that the bundle was built with', () => {
    const published = JSON.parse(read('NPM_PACKAGE_JSON'));
    const dashql = JSON.parse(read('DASHQL_PACKAGE_JSON'));
    const root = JSON.parse(read('ROOT_PACKAGE_JSON'));
    // Both manifests carry the npm version of the same build, CI publishes @akohn/dashql first
    assert.equal(published.version, dashql.version);
    assert.equal(published.dependencies['@akohn/dashql'], dashql.version);
    assert.equal(published.dependencies['hyperdb-wasm'], { ...root.devDependencies, ...root.dependencies }['hyperdb-wasm']);
    assert.equal(published.bin.dashql, './dist/dashql.js');
});

test('the bundle runs as the command of the package', () => {
    assert.ok(read('DASHQL_BUNDLE').startsWith('#!/usr/bin/env node\n'));
});
