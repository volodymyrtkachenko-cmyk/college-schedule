const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const transpileCache = new Map();

function resolveRelativeModule(fromDir, specifier) {
  const basePath = path.resolve(fromDir, specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.cjs`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.cjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`Cannot resolve relative module "${specifier}" from "${fromDir}"`);
}

function getTranspiledCode(filePath) {
  let cached = transpileCache.get(filePath);
  if (cached !== undefined) return cached;
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    fileName: filePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  transpileCache.set(filePath, transpiled);
  return transpiled;
}

/**
 * Compile and evaluate a TypeScript module graph inside an isolated VM context
 * per call, sharing singletons across modules within the same graph while keeping
 * separate test setups completely isolated.
 */
function loadTsModule(entryFilePath, sandboxGlobals = {}) {
  const entryAbsPath = path.resolve(entryFilePath);
  const moduleCache = new Map();

  function loadModule(filePath) {
    if (moduleCache.has(filePath)) {
      return moduleCache.get(filePath).exports;
    }

    const mod = { exports: {} };
    moduleCache.set(filePath, mod);

    const fileDir = path.dirname(filePath);
    const localRequire = (specifier) => {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        return loadModule(resolveRelativeModule(fileDir, specifier));
      }
      return require(specifier);
    };

    const code = getTranspiledCode(filePath);
    const ctx = {
      exports: mod.exports,
      module: mod,
      require: localRequire,
      process: { env: {} },
      Headers,
      URLSearchParams,
      AbortController,
      setTimeout,
      clearTimeout,
      console,
      Intl,
      Date,
      Math,
      Number,
      ...sandboxGlobals,
    };

    vm.runInNewContext(code, ctx, { filename: filePath });
    return mod.exports;
  }

  return loadModule(entryAbsPath);
}

module.exports = { loadTsModule };
