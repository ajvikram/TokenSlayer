/**
 * Module resolution hijack: route every `require('vscode')` to our mock.
 *
 * The Electron host normally provides `vscode` at runtime; under plain Node
 * the module is unresolvable, so this shim is required for unit tests.
 */
'use strict';

const Module = require('node:module');
const path = require('node:path');

const MOCK_PATH = path.join(__dirname, '_mocks', 'vscode.js');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'vscode') return MOCK_PATH;
  return originalResolve.call(this, request, parent, ...rest);
};
