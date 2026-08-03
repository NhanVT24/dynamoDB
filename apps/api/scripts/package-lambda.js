import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const distRoot = join(appRoot, "dist");
const buildRoot = join(distRoot, "src");
const lambdaRoot = join(distRoot, "lambda");
const zipPath = join(distRoot, "lambda.zip");
const packageJsonPath = join(appRoot, "package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

rmSync(lambdaRoot, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(lambdaRoot, { recursive: true });

cpSync(buildRoot, join(lambdaRoot, "src"), { recursive: true });

const lambdaPackageJson = {
  name: `${packageJson.name}-lambda`,
  private: true,
  type: "module",
  dependencies: packageJson.dependencies
};

writeFileSync(join(lambdaRoot, "package.json"), JSON.stringify(lambdaPackageJson, null, 2));

console.log("Installing production dependencies for Lambda package...");
execFileSync("npm", ["install", "--omit=dev"], {
  cwd: lambdaRoot,
  stdio: "inherit",
  shell: process.platform === "win32"
});

console.log("Creating lambda.zip...");
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "Compress-Archive -Path * -DestinationPath ..\\lambda.zip -Force"
  ],
  {
    cwd: lambdaRoot,
    stdio: "inherit"
  }
);

if (!existsSync(zipPath)) {
  throw new Error("Failed to create dist/lambda.zip");
}

console.log(`Lambda package created at ${zipPath}`);
