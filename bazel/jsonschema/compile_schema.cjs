#!/usr/bin/env node
/**
 * Compile a JSON Schema file to TypeScript using json-schema-to-typescript.
 * Handles $ref resolution by reading all schema files in the same directory.
 *
 * Usage: compile_schema.cjs <schema-file>
 */

const { compileFromFile } = require('json-schema-to-typescript');
const fs = require('fs');
const path = require('path');

async function main() {
  if (process.argv.length < 3) {
    console.error('Usage: compile_schema.cjs <schema-file>');
    process.exit(1);
  }

  const schemaPath = process.argv[2];

  try {
    // Read the main schema
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);

    // Read all schemas from the same directory for $ref resolution
    const schemaDir = path.dirname(schemaPath);
    const schemaFiles = fs.readdirSync(schemaDir).filter(f => f.endsWith('.json'));

    // Build a map of schema files for $ref resolution
    const schemas = {};
    for (const file of schemaFiles) {
      const filePath = path.join(schemaDir, file);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      // Store by filename for relative refs like "error.json#"
      schemas[file] = content;
      // Also store by $id if present for absolute refs
      if (content.$id) {
        schemas[content.$id] = content;
      }
    }

    // Custom $ref resolver function
    const $refOptions = {
      resolve: {
        // Handle file-based refs like "error.json#" or "connection.json#/definitions/X"
        file: {
          order: 1,
          canRead: /\.json$/,
          read: (file) => {
            const basename = path.basename(file.url);
            if (schemas[basename]) {
              return schemas[basename];
            }
            // Try without the hash
            const withoutHash = basename.replace(/#.*$/, '');
            if (schemas[withoutHash]) {
              return schemas[withoutHash];
            }
            throw new Error(`Cannot resolve $ref: ${file.url}`);
          },
        },
      },
    };

    // If the schema is only definitions (no root type), export all definitions as top-level types
    if (schema.definitions && !schema.type && !schema.properties) {
      // Use compileFromFile with cwd set to allow proper $ref resolution
      const ts = await compileFromFile(schemaPath, {
        bannerComment: '',
        style: {
          semi: true,
          singleQuote: false,
        },
        strictIndexSignatures: false,
        unknownAny: false,
        unreachableDefinitions: true,  // Export all definitions
        $refOptions,
        cwd: schemaDir,
      });
      process.stdout.write(ts);
    } else {
      // Use compileFromFile for normal schemas
      const ts = await compileFromFile(schemaPath, {
        bannerComment: '',
        style: {
          semi: true,
          singleQuote: false,
        },
        strictIndexSignatures: true,
        unknownAny: false,
        unreachableDefinitions: false,
        $refOptions,
        cwd: schemaDir,
      });
      process.stdout.write(ts);
    }
  } catch (error) {
    console.error(`Error compiling ${schemaPath}:`, error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
