import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(appRoot, "..", "..");
const distRoot = join(appRoot, "dist");
const buildRoot = join(distRoot, "src");
const lambdaRoot = join(distRoot, "lambda");
const lambdaSrcRoot = join(lambdaRoot, "src");
const zipPath = join(distRoot, "lambda.zip");
const packageJsonPath = join(appRoot, "package.json");
const packageLockPath = join(workspaceRoot, "package-lock.json");
const manifestPath = join(distRoot, "lambda-build-manifest.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

function hashFile(filePath, hash) {
  hash.update(relative(workspaceRoot, filePath));
  hash.update(readFileSync(filePath));
}

function hashDirectory(directoryPath, hash) {
  const entries = readdirSync(directoryPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      hashDirectory(fullPath, hash);
      continue;
    }

    hashFile(fullPath, hash);
  }
}

function hashDirectoryRelativeTo(directoryPath, rootPath, hash) {
  const entries = readdirSync(directoryPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      hashDirectoryRelativeTo(fullPath, rootPath, hash);
      continue;
    }

    hash.update(relative(rootPath, fullPath));
    hash.update(readFileSync(fullPath));
  }
}

function createDigest(parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    if (typeof part === "string") {
      hash.update(part);
    } else {
      hashDirectory(part, hash);
    }
  }
  return hash.digest("hex");
}

function createRootRelativeDigest(directoryPath) {
  const hash = createHash("sha256");
  hashDirectoryRelativeTo(directoryPath, directoryPath, hash);
  return hash.digest("hex");
}

function readManifest() {
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function writeManifest(manifest) {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function ensureLambdaPackageJson() {
  const lambdaPackageJson = {
    name: `${packageJson.name}-lambda`,
    private: true,
    type: "module",
    dependencies: packageJson.dependencies,
    overrides: packageJson.overrides
  };

  writeFileSync(join(lambdaRoot, "package.json"), JSON.stringify(lambdaPackageJson, null, 2));
}

function copyBuildOutput() {
  rmSync(lambdaSrcRoot, { recursive: true, force: true });
  cpSync(buildRoot, lambdaSrcRoot, { recursive: true });
}

function installProductionDependencies() {
  console.log("Installing production dependencies for Lambda package...");
  if (process.platform === "win32") {
    execFileSync(
      "cmd.exe",
      ["/d", "/s", "/c", "npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefer-offline"],
      {
        cwd: lambdaRoot,
        stdio: "inherit"
      }
    );
    return;
  }

  execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], {
    cwd: lambdaRoot,
    stdio: "inherit"
  });
}

function createZipArchive() {
  console.log("Creating lambda.zip...");
  rmSync(zipPath, { force: true });

  try {
    execFileSync("tar", ["-a", "-cf", zipPath, "-C", lambdaRoot, "."], {
      stdio: "inherit"
    });
  } catch {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($pwd.Path, '..\\lambda.zip')"
      ],
      {
        cwd: lambdaRoot,
        stdio: "inherit"
      }
    );
  }

  if (!existsSync(zipPath)) {
    throw new Error("Failed to create dist/lambda.zip");
  }
}

if (!existsSync(buildRoot) || !statSync(buildRoot).isDirectory()) {
  throw new Error(`Missing compiled Lambda sources at ${buildRoot}. Run the TypeScript build first.`);
}

mkdirSync(distRoot, { recursive: true });
mkdirSync(lambdaRoot, { recursive: true });

const sourceHash = createDigest([buildRoot]);
const dependencyHash = createDigest([
  JSON.stringify(packageJson.dependencies ?? {}),
  existsSync(packageLockPath) ? readFileSync(packageLockPath, "utf8") : ""
]);

const previousManifest = readManifest();
const isSourceUnchanged = previousManifest?.sourceHash === sourceHash;
const areDependenciesUnchanged = previousManifest?.dependencyHash === dependencyHash;
const isLambdaSourceSynced =
  existsSync(lambdaSrcRoot) &&
  statSync(lambdaSrcRoot).isDirectory() &&
  createRootRelativeDigest(lambdaSrcRoot) === createRootRelativeDigest(buildRoot);
const canReuseZip = isSourceUnchanged && areDependenciesUnchanged && isLambdaSourceSynced && existsSync(zipPath);
const hasInstalledDependencies = existsSync(join(lambdaRoot, "node_modules"));

if (canReuseZip) {
  console.log("Lambda package unchanged. Reusing existing lambda.zip.");
  process.exit(0);
}

copyBuildOutput();
ensureLambdaPackageJson();

if (!areDependenciesUnchanged || !hasInstalledDependencies) {
  rmSync(join(lambdaRoot, "node_modules"), { recursive: true, force: true });
  installProductionDependencies();
} else {
  console.log("Lambda dependencies unchanged. Reusing existing node_modules.");
}

createZipArchive();
writeManifest({
  sourceHash,
  dependencyHash,
  zipPath
});

console.log(`Lambda package created at ${zipPath}`);
