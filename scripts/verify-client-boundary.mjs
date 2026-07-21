import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const clientOutput = path.resolve(".next/static");
const forbiddenMarkers = [
  "DATABASE_URL",
  "UKIEBOOK_SERVER_ENV_ONLY_v1",
  "postgres://ukiebook:ukiebook@127.0.0.1:5432/ukiebook",
  "unit00-browser-secret-sentinel-4f8d7b68",
  process.env.UNIT00_SECRET_SENTINEL
].filter(Boolean);

const sourceRoots = ["app", "components", "modules"];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(target) : [target];
    })
  );
  return nested.flat();
}

const files = await listFiles(clientOutput);
const leaks = [];

for (const file of files) {
  const contents = await readFile(file);
  const text = contents.toString("utf8");
  for (const marker of forbiddenMarkers) {
    if (text.includes(marker)) {
      leaks.push({ file: path.relative(process.cwd(), file), marker });
    }
  }
}

const sourceFiles = (
  await Promise.all(
    sourceRoots.map(async (root) => {
      try {
        return await listFiles(path.resolve(root));
      } catch (error) {
        if (error?.code === "ENOENT") {
          return [];
        }
        throw error;
      }
    })
  )
)
  .flat()
  .filter((file) => /\.[cm]?[jt]sx?$/.test(file));
const invalidClientImports = [];

for (const file of sourceFiles) {
  const text = await readFile(file, "utf8");
  if (
    /^\s*["']use client["'];/m.test(text) &&
    text.includes("environment/server")
  ) {
    invalidClientImports.push(path.relative(process.cwd(), file));
  }
}

if (leaks.length > 0 || invalidClientImports.length > 0) {
  console.error("Client/server secret boundary verification failed:");
  for (const leak of leaks) {
    console.error(`- ${leak.marker} in ${leak.file}`);
  }
  for (const file of invalidClientImports) {
    console.error(`- client module imports server environment: ${file}`);
  }
  process.exitCode = 1;
} else {
  if (process.env.UNIT_EVIDENCE_DIR) {
    const target = path.join(
      path.resolve(process.env.UNIT_EVIDENCE_DIR),
      "evidence/security/client-secret-boundary.json",
    );
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      `${JSON.stringify(
        {
          checked_client_files: files.map((file) =>
            path.relative(process.cwd(), file),
          ),
          checked_source_files: sourceFiles.length,
          forbidden_marker_categories: [
            "database-environment-key",
            "server-bundle-marker",
            "known-test-database-url",
            "build-sentinel",
          ],
          invalid_client_imports: invalidClientImports,
          leaks: [],
          status: "passed",
          verified_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  console.log(
    `Client secret boundary passed across ${files.length} static files and ${sourceFiles.length} source files.`
  );
}
