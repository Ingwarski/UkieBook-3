import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

const repositoryRoot = process.cwd();
const sourceRoots = ["app", "components", "db", "modules", "workers"];
const extensions = [".ts", ".tsx", ".mts", ".cts"];
const findings = [];
const includeNegativeFixture = process.argv.includes("--negative-fixture");

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listSourceFiles(target);
      }
      return extensions.includes(path.extname(entry.name)) ? [target] : [];
    }),
  );
  return nested.flat();
}

const productionFiles = (
  await Promise.all(sourceRoots.map((root) => listSourceFiles(path.resolve(root))))
).flat();
const files = includeNegativeFixture
  ? [
      ...productionFiles,
      path.resolve("tests/fixtures/client-boundary/client.fixture"),
      path.resolve("tests/fixtures/client-boundary/reexport.fixture"),
    ]
  : productionFiles;
const sourceSet = new Set(files.map((file) => path.normalize(file)));

function parseModule(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function moduleSpecifiers(sourceFile) {
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function resolveSourceImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(repositoryRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return undefined;
  }

  const candidates = [
    base,
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.map(path.normalize).find((candidate) => sourceSet.has(candidate));
}

const modules = new Map();
for (const file of files) {
  const text = await readFile(file, "utf8");
  const sourceFile = parseModule(file, text);
  const specifiers = moduleSpecifiers(sourceFile);
  const dependencies = specifiers
    .map((specifier) => resolveSourceImport(file, specifier))
    .filter(Boolean);
  const isClient = sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use client",
  );
  modules.set(path.normalize(file), { dependencies, isClient, specifiers });
}

const serverEnvironment = path.normalize(
  path.resolve("modules/platform/environment/server.ts"),
);
const runtimeEnvironment = path.normalize(
  path.resolve("modules/platform/environment/runtime.ts"),
);
const sensitiveEnvironmentFiles = new Set([serverEnvironment, runtimeEnvironment]);
const sensitiveServerFiles = new Set(
  files
    .map(path.normalize)
    .filter((file) => {
      const relative = path.relative(repositoryRoot, file);
      return (
        relative.startsWith("modules/identity/server/") ||
        relative.startsWith("modules/author-profile/server/") ||
        relative.startsWith("modules/payout-details/server/") ||
        relative.startsWith("modules/catalog/server/") ||
        relative.startsWith("modules/platform/server/")
      );
    }),
);
const sensitiveClientBoundaryFiles = new Set([
  ...sensitiveEnvironmentFiles,
  ...sensitiveServerFiles,
]);
const allowedRuntimeImporters = new Set(
  [
    "modules/platform/environment/server.ts",
    "workers/worker.ts",
    "workers/scheduler.ts",
    "db/migrations/cli.ts",
  ].map((file) => path.normalize(path.resolve(file))),
);

const serverFacade = modules.get(serverEnvironment);
if (!serverFacade?.specifiers.includes("server-only")) {
  findings.push({
    rule: "server-only-facade",
    summary: "The canonical server environment facade must import server-only.",
  });
}

for (const [file, module] of modules) {
  if (
    module.dependencies.includes(runtimeEnvironment) &&
    !allowedRuntimeImporters.has(file)
  ) {
    findings.push({
      file: path.relative(repositoryRoot, file),
      rule: "runtime-env-import-policy",
      summary: "Only approved Node entrypoints may import the process environment reader.",
    });
  }

  const relative = path.relative(repositoryRoot, file);
  if (/^(modules|db|workers)\//.test(relative)) {
    for (const dependency of module.dependencies) {
      const dependencyRelative = path.relative(repositoryRoot, dependency);
      if (/^(app|components)\//.test(dependencyRelative)) {
        findings.push({
          file: relative,
          dependency: dependencyRelative,
          rule: "inward-dependency-direction",
          summary: "Platform, data, and process layers cannot depend on UI layers.",
        });
      }
    }
  }
}

for (const [clientFile, module] of modules) {
  if (!module.isClient) {
    continue;
  }

  const queue = module.dependencies.map((dependency) => ({
    file: dependency,
    chain: [clientFile, dependency],
  }));
  const visited = new Set([clientFile]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.file)) {
      continue;
    }
    visited.add(current.file);
    if (sensitiveClientBoundaryFiles.has(current.file)) {
      findings.push({
        file: path.relative(repositoryRoot, clientFile),
        chain: current.chain.map((item) => path.relative(repositoryRoot, item)),
        rule: "transitive-client-secret-boundary",
        summary: "A Client Component transitively reaches a server-only identity or environment boundary.",
      });
      break;
    }
    const currentModule = modules.get(current.file);
    for (const dependency of currentModule?.dependencies ?? []) {
      queue.push({ file: dependency, chain: [...current.chain, dependency] });
    }
  }
}

const result = {
  checked_files: files.length,
  client_roots: [...modules.values()].filter((module) => module.isClient).length,
  findings,
  rules: [
    "server-only-facade",
    "runtime-env-import-policy",
    "transitive-client-secret-boundary",
    "inward-dependency-direction",
  ],
  status: findings.length === 0 ? "passed" : "failed",
  verified_at: new Date().toISOString(),
};

if (process.env.UNIT_EVIDENCE_DIR) {
  const target = path.join(
    path.resolve(process.env.UNIT_EVIDENCE_DIR),
    "evidence/architecture/boundary-review.json",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

if (findings.length > 0) {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    `Source boundaries passed across ${result.checked_files} files and ${result.client_roots} client roots.`,
  );
}
