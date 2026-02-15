import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as TJS from "typescript-json-schema";

type JsonObject = Record<string, unknown>;

interface GeneratedMethodsFile {
  generatedFrom: string;
  methods: string[];
}

interface GeneratedContractFile {
  generatedFrom: string;
  schema: JsonObject;
  methodInputMapSchema: JsonObject;
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readPackageVersion(pkgPath: string): string {
  const packageJson = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    version?: string;
  };
  if (!packageJson.version) {
    throw new Error(`Missing version in ${pkgPath}`);
  }
  return packageJson.version;
}

function createInputSchema(projectRoot: string): JsonObject {
  const sourcePath = resolve(
    projectRoot,
    "src/telegram/bot/generated/bot-api-contract-types.ts",
  );
  const compilerOptions: TJS.CompilerOptions = {
    strictNullChecks: true,
    target: "es2022",
    module: "esnext",
    moduleResolution: "bundler",
    esModuleInterop: true,
    resolveJsonModule: true,
  };
  const settings: TJS.PartialArgs = {
    required: true,
    noExtraProps: true,
    ignoreErrors: false,
    titles: false,
    topRef: false,
    strictNullChecks: true,
    refs: true,
  };
  const program = TJS.getProgramFromFiles(
    [sourcePath],
    compilerOptions,
    projectRoot,
  );
  const schema = TJS.generateSchema(program, "BotApiMethodInputMap", settings);
  if (!schema || typeof schema !== "object") {
    throw new Error("Unable to generate Bot API input schema");
  }
  return schema as JsonObject;
}

function ensureMethodList(schema: JsonObject): string[] {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") {
    throw new Error("Generated schema does not contain a properties object");
  }

  return Object.keys(properties).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function assertFileMatches(path: string, expected: string): void {
  const current = readFileSync(path, "utf8");
  if (current !== expected) {
    throw new Error(
      `Generated file is outdated: ${path}. Run "npm run generate:bot-contract".`,
    );
  }
}

function writeOrCheck(path: string, content: string, checkMode: boolean): void {
  if (checkMode) {
    assertFileMatches(path, content);
    return;
  }
  writeFileSync(path, content, "utf8");
}

function main(): void {
  const checkMode = process.argv.includes("--check");
  const projectRoot = process.cwd();
  const typesPkgVersion = readPackageVersion(
    resolve(projectRoot, "node_modules/@grammyjs/types/package.json"),
  );
  const generatedFrom = `@grammyjs/types@${typesPkgVersion}`;

  const inputSchema = createInputSchema(projectRoot);
  const methods = ensureMethodList(inputSchema);

  const methodsFile: GeneratedMethodsFile = {
    generatedFrom,
    methods,
  };
  const contractFile: GeneratedContractFile = {
    generatedFrom,
    schema: inputSchema,
    methodInputMapSchema: inputSchema,
  };

  const methodsPath = resolve(
    projectRoot,
    "src/telegram/bot/generated/bot-api-methods.generated.json",
  );
  const contractPath = resolve(
    projectRoot,
    "src/telegram/bot/generated/bot-api-contract.generated.json",
  );

  writeOrCheck(methodsPath, stableStringify(methodsFile), checkMode);
  writeOrCheck(contractPath, stableStringify(contractFile), checkMode);
  if (!checkMode) {
    console.log(`Generated ${methods.length} Telegram Bot API methods`);
  }
}

main();
