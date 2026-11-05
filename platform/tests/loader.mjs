import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let ts;
try {
  ts = require('typescript');
} catch {
  try {
    ts = require('../../node_modules/typescript');
  } catch {
    ts = null;
  }
}

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.resolve(THIS_DIR, '..');

function resolveFileWithExtensions(basePath) {
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return basePath;
  }
  if (basePath.endsWith('.js')) {
    const tsCandidate = basePath.slice(0, -3) + '.ts';
    if (fs.existsSync(tsCandidate) && fs.statSync(tsCandidate).isFile()) {
      return tsCandidate;
    }
  }
  for (const ext of ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') {
    return {
      format: 'module',
      shortCircuit: true,
      url: 'virtual:next/server',
    };
  }

  if (specifier === '@kazibox/sdk') {
    const candidate = path.resolve(PLATFORM_DIR, '../packages/sdk/src/index.ts');
    if (fs.existsSync(candidate)) {
      return {
        format: 'module',
        shortCircuit: true,
        url: pathToFileURL(candidate).href,
      };
    }
  }

  if (specifier.startsWith('@/')) {
    const subpath = specifier.slice(2);
    const candidate = resolveFileWithExtensions(path.join(PLATFORM_DIR, subpath));
    if (candidate) {
      return {
        format: 'module',
        shortCircuit: true,
        url: pathToFileURL(candidate).href,
      };
    }
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (context.parentURL && context.parentURL.startsWith('file://')) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const targetPath = path.resolve(parentDir, specifier);
      const candidate = resolveFileWithExtensions(targetPath);
      if (candidate) {
        return {
          format: 'module',
          shortCircuit: true,
          url: pathToFileURL(candidate).href,
        };
      }
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'virtual:next/server') {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        import { createRequire } from 'node:module';
        const req = createRequire('file:///G:/data/KaziBox/platform/node_modules/next/server.js');
        const nextServer = req('G:/data/KaziBox/platform/node_modules/next/server.js');
        export const NextRequest = nextServer.NextRequest;
        export const NextResponse = nextServer.NextResponse;
        export default nextServer;
      `,
    };
  }

  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const filePath = fileURLToPath(url);
    const source = fs.readFileSync(filePath, 'utf8');
    if (ts) {
      const result = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
        fileName: filePath,
      });
      return {
        format: 'module',
        shortCircuit: true,
        source: result.outputText,
      };
    }
  }

  return nextLoad(url, context);
}
