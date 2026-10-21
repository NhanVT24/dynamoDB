import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Inventory prevents new features silently falling outside the core import check.
 * Reachability checks wiring, not the semantics of every method in the graph.
 */
export function checkCoverage(sourceRoot, inventory, compilerOptions = {}) {
  const violations = [], cache = new Map();
  const options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, ...compilerOptions };
  const relative = file => path.relative(sourceRoot, file).replaceAll(path.sep, "/");
  const all = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? all(file) : file.endsWith(".ts") ? [file] : [];
  });
  function imports(file) {
    if (cache.has(file)) return cache.get(file);
    const dependencies = [];
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
        const onlyNamedTypes = bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
          bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly) &&
          !(ts.isImportDeclaration(node) && node.importClause?.name);
        dependencies.push({ specifier, resolved, typeOnly: node.isTypeOnly || node.importClause?.isTypeOnly || onlyNamedTypes });
      }
      ts.forEachChild(node, walk);
    }
    walk(source); cache.set(file, dependencies); return dependencies;
  }
  function reachesApplication(file, visited = new Set()) {
    if (visited.has(file)) return false;
    visited.add(file);
    if (relative(file).includes("/application/")) return true;
    return imports(file).some(item => !item.typeOnly && item.resolved &&
      !relative(item.resolved).startsWith("../") && reachesApplication(item.resolved, visited));
  }
  const modulesRoot = path.join(sourceRoot, "modules");
  const modules = fs.readdirSync(modulesRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  const files = all(sourceRoot);
  for (const module of modules) {
    const policy = inventory.modules[module];
    if (!policy) { violations.push(`modules/${module}: feature is missing from the architecture inventory.`); continue; }
    if (policy.kind === "technical") {
      if (!policy.reason) violations.push(`modules/${module}: technical exception needs a reason.`);
    } else if (!files.some(file => relative(file).startsWith(`modules/${module}/`) && relative(file).includes("/application/"))) {
      violations.push(`modules/${module}: business feature has no application layer.`);
    }
  }
  for (const module of Object.keys(inventory.modules)) if (!modules.includes(module)) violations.push(`Stale module inventory: ${module}`);
  const entrypoints = files.filter(file => {
    const name = relative(file);
    return name.endsWith(".controller.ts") || /^entrypoints\/lambda\/(jobs|queue|workflow|cognito\/triggers)\/[^/]+\.ts$/.test(name);
  });
  for (const file of entrypoints) {
    const name = relative(file);
    const module = /^modules\/([^/]+)\//.exec(name)?.[1];
    const exception = inventory.technicalEntrypoints[name] || (module && inventory.modules[module]?.kind === "technical" && inventory.modules[module].reason);
    if (exception) continue;
    if (!reachesApplication(file)) violations.push(`${name}: entrypoint does not reach an application implementation through runtime imports.`);
    if (name.endsWith(".controller.ts")) {
      for (const { specifier } of imports(file)) {
        if (/@aws-sdk|(?:^|\/)(?:database|integrations|infrastructure)(?:\/|$)|repository(?:\.js)?$/.test(specifier)) {
          violations.push(`${name}: controller depends directly on ${specifier}; call an application use case/facade.`);
        }
      }
    }
  }
  for (const [file, reason] of Object.entries(inventory.technicalEntrypoints)) {
    if (!reason || !entrypoints.some(entry => relative(entry) === file)) violations.push(`Stale or unexplained entrypoint exception: ${file}`);
  }
  return { modules: modules.length, entrypoints: entrypoints.length, violations };
}
