/**
 * Minimal `vscode` API mock for unit-testing the TokenSlayer extension.
 *
 * Backs `workspace.fs` with a real temp directory so file-modifying logic
 * (e.g. wireUp) is verified against actual filesystem behavior instead of
 * a fragile in-memory stub. Tests call `__setWorkspaceRoot(dir)` to point
 * the mock at a fresh temp dir per test.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ---- Symbol kinds (matches vscode.SymbolKind numeric enum exactly) -------

const SymbolKind = {
  File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5,
  Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10,
  Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15,
  Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
  Struct: 22, Event: 23, Operator: 24, TypeParameter: 25,
};

// ---- Uri (path-backed, no scheme machinery) -------------------------------

class Uri {
  constructor(fsPath) {
    this.fsPath = fsPath;
    this.scheme = 'file';
    this.path = fsPath;
  }
  static file(p) { return new Uri(p); }
  static joinPath(base, ...parts) { return new Uri(path.join(base.fsPath, ...parts)); }
  toString() { return 'file://' + this.fsPath; }
}

// ---- workspace.fs (backed by real fs) ------------------------------------

const workspaceFs = {
  async readFile(uri) {
    const buf = await fs.promises.readFile(uri.fsPath);
    return new Uint8Array(buf);
  },
  async writeFile(uri, data) {
    await fs.promises.writeFile(uri.fsPath, Buffer.from(data));
  },
  async createDirectory(uri) {
    await fs.promises.mkdir(uri.fsPath, { recursive: true });
  },
  async stat(uri) {
    const s = await fs.promises.stat(uri.fsPath);
    return { type: s.isDirectory() ? 2 : 1, size: s.size, ctime: s.ctimeMs, mtime: s.mtimeMs };
  },
};

// ---- workspace + window with test introspection -------------------------

let _workspaceRoot = null;
const _shownMessages = []; // {type, message, buttons}
let _messageResponse = undefined; // forced response to next showInformation/Warning

let _configOverrides = {};

const workspace = {
  get workspaceFolders() {
    return _workspaceRoot ? [{ uri: _workspaceRoot, name: 'test', index: 0 }] : undefined;
  },
  fs: workspaceFs,
  getConfiguration(_section) {
    return {
      get(key, defaultValue) {
        const fullKey = _section ? `${_section}.${key}` : key;
        return fullKey in _configOverrides ? _configOverrides[fullKey] : defaultValue;
      },
    };
  },
};

const window = {
  createOutputChannel(_name) {
    return {
      appendLine: () => {},
      append: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {},
      clear: () => {},
    };
  },
  showInformationMessage(message, ...buttons) {
    _shownMessages.push({ type: 'info', message, buttons });
    return Promise.resolve(_messageResponse);
  },
  showWarningMessage(message, ...buttons) {
    _shownMessages.push({ type: 'warning', message, buttons });
    return Promise.resolve(_messageResponse);
  },
  showErrorMessage(message, ...buttons) {
    _shownMessages.push({ type: 'error', message, buttons });
    return Promise.resolve(_messageResponse);
  },
  showTextDocument(_uri) {
    return Promise.resolve({});
  },
};

const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

// ---- Test-only introspection helpers (prefixed with __) ----------------

function __setWorkspaceRoot(p) {
  _workspaceRoot = p ? new Uri(p) : null;
}
function __getShownMessages() {
  return _shownMessages.slice();
}
function __clearShownMessages() {
  _shownMessages.length = 0;
}
function __setNextMessageResponse(r) {
  _messageResponse = r;
}
function __setConfigOverrides(overrides) {
  _configOverrides = overrides;
}

module.exports = {
  SymbolKind,
  Uri,
  FileType,
  workspace,
  window,
  __setWorkspaceRoot,
  __getShownMessages,
  __clearShownMessages,
  __setNextMessageResponse,
  __setConfigOverrides,
};
