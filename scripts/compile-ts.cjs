const ts = require('typescript');
const path = require('path');

function compile(configPath) {
  console.log(`Compiling ${configPath}...`);
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    console.error('Error reading config:', configFile.error);
    process.exit(1);
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const emitResult = program.emit();
  const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
  for (const diag of allDiagnostics) {
    if (diag.file) {
      const { line, character } = ts.getLineAndCharacterOfPosition(diag.file, diag.start);
      const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
      console.log(`  ${diag.file.fileName} (${line + 1},${character + 1}): ${message}`);
    } else {
      console.log(`  ${ts.flattenDiagnosticMessageText(diag.messageText, '\n')}`);
    }
  }
  if (emitResult.emitSkipped || allDiagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) {
    console.error(`Build failed for ${configPath}`);
    process.exit(1);
  }
  console.log(`Successfully built ${configPath}`);
}

const target = process.argv[2];
if (target) {
  compile(path.resolve(target));
} else {
  compile(path.resolve('packages/sdk/tsconfig.json'));
  compile(path.resolve('modules/pharmastock/tsconfig.json'));
  compile(path.resolve('modules/minimal-saas/tsconfig.json'));
}
