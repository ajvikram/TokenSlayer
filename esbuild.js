'use strict';

// Bundles the extension into a single dist/extension.js so the published VSIX
// ships ~3MB instead of ~26MB. The 26MB was gpt-tokenizer's full encoding data;
// esbuild tree-shakes it to only the cl100k encoding the extension actually uses
// (verified: encode() works identically post-bundle). `vscode` is provided by
// the host at runtime and must stay external.

const esbuild = require('esbuild');

const production = process.argv.includes('--production');

esbuild
  .build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    logLevel: 'info',
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
