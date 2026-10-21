import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { checkCoverage } from "./check-architecture-coverage.js";

const layerOf = file => /[/\\](application|domain)[/\\]/.exec(file)?.[1];

/** Check the actual TS syntax, including erased imports and re-exports.
 * Core may reference core only. This also prevents escaping through an outer barrel.
 * Entry points and feature coverage are checked separately by checkCoverage.
 */
export function checkArchitecture(sourceRoot, compilerOptions = {}) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith(".ts") && layerOf(file)) files.push(file);
    }
  }
  visit(sourceRoot);
  const violations = [];
  const options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, ...compilerOptions };
  for (const file of files) {
    const layer = layerOf(file);
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const report = (node, message) => violations.push(`${path.relative(sourceRoot, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${message}`);
    function check(node, literal) {
      if (!literal || !ts.isStringLiteralLike(literal)) {
        report(node, "Computed module imports are not allowed in the business core.");
        return;
      }
      const specifier = literal.text;
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
      const target = resolved?.resolvedFileName;
      const relative = target && path.relative(sourceRoot, target);
      const inside = relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
      const targetLayer = inside ? layerOf(target) : undefined;
      if (!targetLayer || (layer === "domain" && targetLayer !== "domain")) {
        report(node, `${layer} cannot depend on ${specifier}; use a domain type/policy or an application port.`);
      }
    }
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check(node, node.moduleSpecifier);
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) check(node, node.moduleReference.expression);
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) check(node, node.argument.literal);
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) check(node, node.arguments[0]);
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  return { checkedFiles: files.length, violations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apiRoot = fileURLToPath(new URL("../", import.meta.url));
  const config = ts.readConfigFile(path.join(apiRoot, "tsconfig.json"), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, apiRoot);
  const result = checkArchitecture(path.join(apiRoot, "src"), parsed.options);
  const inventory = JSON.parse(fs.readFileSync(path.join(apiRoot, "scripts/architecture-inventory.json"), "utf8"));
  const coverage = checkCoverage(path.join(apiRoot, "src"), inventory, parsed.options);
  if (!result.checkedFiles) throw new Error("No application/domain files found; refusing an empty architecture check.");
  console.log(`Architecture: ${result.checkedFiles} core files checked, ${result.violations.length} violations.`);
  for (const violation of result.violations) console.error(violation);
  console.log(`Coverage: ${coverage.modules} modules, ${coverage.entrypoints} entrypoints, ${coverage.violations.length} violations.`);
  for (const violation of coverage.violations) console.error(violation);
  process.exitCode = result.violations.length || coverage.violations.length ? 1 : 0;
}
