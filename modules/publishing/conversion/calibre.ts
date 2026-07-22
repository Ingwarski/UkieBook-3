import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ConversionAbortedError,
  ConversionEngineUnavailableError,
  ConversionExecutionError,
  ConversionInputError,
} from "./errors";
import { sha256 } from "./hash";
import { createCalibreHtmlInput } from "./html";
import { inspectRasterImage } from "./raster";
import {
  CONVERSION_RESULT_SCHEMA_VERSION,
  PRIVATE_ARTIFACT_SCHEMA_VERSION,
  type ConversionEngineBlocker,
  type ConversionEngineProbe,
  type ConversionResult,
  type ConvertManuscriptRequest,
  type PrivateEpubConversionArtifact,
  type PrivateMobiConversionArtifact,
} from "./types";
import { validateEpub, validateLegacyMobi } from "./validators";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;

function conversionProcessEnvironment(workingDirectory: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CALIBRE_ALLOW_PYTHON_TEMPLATES: "0",
    CALIBRE_CACHE_DIRECTORY: path.join(workingDirectory, ".calibre-cache"),
    CALIBRE_CONFIG_DIRECTORY: path.join(workingDirectory, ".calibre-config"),
    CALIBRE_TEMP_DIR: path.join(workingDirectory, ".calibre-temp"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  for (const name of [
    "HOME",
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LD_LIBRARY_PATH",
    "DYLD_LIBRARY_PATH",
    "SYSTEMROOT",
  ]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

export interface ProcessRunResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
}

export interface ConversionProcessRunner {
  run(
    executablePath: string,
    arguments_: readonly string[],
    options: {
      readonly cwd: string;
      readonly signal?: AbortSignal;
      readonly timeoutMs: number;
    },
  ): Promise<ProcessRunResult>;
}

class NodeConversionProcessRunner implements ConversionProcessRunner {
  async run(
    executablePath: string,
    arguments_: readonly string[],
    options: {
      readonly cwd: string;
      readonly signal?: AbortSignal;
      readonly timeoutMs: number;
    },
  ): Promise<ProcessRunResult> {
    await Promise.all(
      [".calibre-cache", ".calibre-config", ".calibre-temp"].map(
        (directory) =>
          mkdir(path.join(options.cwd, directory), { recursive: true }),
      ),
    );
    return new Promise((resolve, reject) => {
      const child = spawn(executablePath, arguments_, {
        cwd: options.cwd,
        // The converter needs runtime paths, not database or OAuth credentials
        // inherited by the worker process.
        env: conversionProcessEnvironment(options.cwd),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const abort = (): void => {
        if (!settled) child.kill("SIGKILL");
      };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, options.timeoutMs);

      const cleanup = (): void => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutBytes < MAX_PROCESS_OUTPUT_BYTES) {
          stdout.push(chunk.subarray(0, MAX_PROCESS_OUTPUT_BYTES - stdoutBytes));
          stdoutBytes += chunk.length;
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrBytes < MAX_PROCESS_OUTPUT_BYTES) {
          stderr.push(chunk.subarray(0, MAX_PROCESS_OUTPUT_BYTES - stderrBytes));
          stderrBytes += chunk.length;
        }
      });
      child.once("error", (error) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(error);
        }
      });
      child.once("close", (exitCode, signal) => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve({
            exitCode,
            signal,
            stderr: Buffer.concat(stderr).toString("utf8"),
            stdout: Buffer.concat(stdout).toString("utf8"),
          });
        }
      });
    });
  }
}

export interface CalibreEbookConverterOptions {
  readonly executablePath: string;
  readonly maxArtifactBytes?: number;
  readonly now?: () => Date;
  readonly processRunner?: ConversionProcessRunner;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly workingDirectory?: string;
}

function blocker(executablePath: string): ConversionEngineBlocker {
  return {
    code: "CONVERSION_ENGINE_UNAVAILABLE",
    engine: "calibre-ebook-convert",
    executablePath,
    remediation:
      "Install the pinned Calibre runtime and set CALIBRE_EBOOK_CONVERT_PATH to its ebook-convert executable.",
    type: "missing-conversion-engine",
  };
}

function parseVersion(output: string): string {
  return output.match(/(?:calibre\s+)?([0-9]+(?:\.[0-9]+){1,3})/iu)?.[1] ?? "unknown";
}

function requireBookVersionId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized)) {
    throw new Error("bookVersionId must be a storage-safe stable identifier");
  }
  return normalized;
}

function truncatedDiagnostic(value: string): string {
  const normalized = value.trim();
  return normalized.length <= 2_000 ? normalized : normalized.slice(-2_000);
}

export class CalibreEbookConverter {
  readonly executablePath: string;
  readonly maxArtifactBytes: number;
  readonly now: () => Date;
  readonly processRunner: ConversionProcessRunner;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly workingDirectory: string;

  constructor(options: CalibreEbookConverterOptions) {
    this.executablePath = options.executablePath;
    this.maxArtifactBytes =
      options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    this.now = options.now ?? (() => new Date());
    this.processRunner = options.processRunner ?? new NodeConversionProcessRunner();
    this.signal = options.signal;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.workingDirectory = options.workingDirectory ?? os.tmpdir();
    if (
      !Number.isSafeInteger(this.maxArtifactBytes) ||
      this.maxArtifactBytes <= 0
    ) {
      throw new Error("maxArtifactBytes must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive safe integer");
    }
  }

  async probe(): Promise<ConversionEngineProbe> {
    if (this.signal?.aborted) {
      throw new ConversionAbortedError();
    }
    let probeDirectory: string | null = null;
    try {
      await mkdir(this.workingDirectory, { recursive: true });
      probeDirectory = await mkdtemp(
        path.join(this.workingDirectory, "ukiebook-calibre-probe-"),
      );
      const result = await this.processRunner.run(
        this.executablePath,
        ["--version"],
        {
          cwd: probeDirectory,
          signal: this.signal,
          timeoutMs: Math.min(this.timeoutMs, 30_000),
        },
      );
      if (this.signal?.aborted) {
        throw new ConversionAbortedError();
      }
      if (result.exitCode !== 0) {
        return { available: false, blocker: blocker(this.executablePath) };
      }
      return {
        available: true,
        engine: {
          executablePath: this.executablePath,
          name: "calibre-ebook-convert",
          version: parseVersion(`${result.stdout}\n${result.stderr}`),
        },
      };
    } catch (error) {
      if (error instanceof ConversionAbortedError || this.signal?.aborted) {
        throw new ConversionAbortedError();
      }
      return { available: false, blocker: blocker(this.executablePath) };
    } finally {
      if (probeDirectory) {
        await rm(probeDirectory, { force: true, recursive: true }).catch(
          () => undefined,
        );
      }
    }
  }

  private async convertFormat(
    inputPath: string,
    outputPath: string,
    format: "epub" | "mobi",
    metadata: { readonly authorName: string; readonly title: string },
    cwd: string,
    coverPath?: string,
  ): Promise<Uint8Array> {
    const arguments_ = [
      inputPath,
      outputPath,
      "--title",
      metadata.title,
      "--authors",
      metadata.authorName,
      "--language",
      "uk",
      ...(coverPath ? ["--cover", coverPath] : []),
      ...(format === "mobi" ? ["--mobi-file-type", "old"] : []),
    ];
    let result: ProcessRunResult;
    try {
      result = await this.processRunner.run(this.executablePath, arguments_, {
        cwd,
        signal: this.signal,
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      if (this.signal?.aborted) {
        throw new ConversionAbortedError();
      }
      throw new ConversionExecutionError(
        format,
        `Could not launch Calibre for ${format.toUpperCase()} conversion`,
        { cause: error },
      );
    }
    if (this.signal?.aborted) {
      throw new ConversionAbortedError();
    }
    if (result.exitCode !== 0) {
      const diagnostic = truncatedDiagnostic(result.stderr || result.stdout);
      throw new ConversionExecutionError(
        format,
        `Calibre ${format.toUpperCase()} conversion failed${diagnostic ? `: ${diagnostic}` : ""}`,
      );
    }
    try {
      const output = await stat(outputPath);
      if (
        !output.isFile() ||
        output.size <= 0 ||
        output.size > this.maxArtifactBytes
      ) {
        throw new Error(
          `artifact size ${output.size} is outside 1..${this.maxArtifactBytes} bytes`,
        );
      }
      const bytes = await readFile(outputPath);
      if (bytes.byteLength !== output.size) {
        throw new Error("artifact size changed while it was being read");
      }
      return new Uint8Array(bytes);
    } catch (error) {
      throw new ConversionExecutionError(
        format,
        `Calibre did not produce the ${format.toUpperCase()} artifact`,
        { cause: error },
      );
    }
  }

  async convert(request: ConvertManuscriptRequest): Promise<ConversionResult> {
    if (this.signal?.aborted) {
      throw new ConversionAbortedError();
    }
    const bookVersionId = requireBookVersionId(request.bookVersionId);
    if (request.cover) {
      try {
        const cover = inspectRasterImage(request.cover.bytes);
        if (cover.mediaType !== request.cover.mediaType) {
          throw new Error(
            `declared ${request.cover.mediaType} does not match ${cover.mediaType}`,
          );
        }
      } catch (error) {
        throw new ConversionInputError("Cover is not a safe bounded PNG or JPEG", {
          cause: error,
        });
      }
    }
    const probe = await this.probe();
    if (!probe.available) {
      throw new ConversionEngineUnavailableError(probe.blocker);
    }
    await mkdir(this.workingDirectory, { recursive: true });
    const workspace = await mkdtemp(
      path.join(this.workingDirectory, "ukiebook-conversion-"),
    );
    try {
      const inputDirectory = path.join(workspace, "input");
      const outputDirectory = path.join(workspace, "output");
      await mkdir(inputDirectory, { recursive: true });
      await mkdir(outputDirectory, { recursive: true });
      const htmlInput = createCalibreHtmlInput(request.manuscript);
      const htmlPath = path.join(inputDirectory, "manuscript.html");
      await writeFile(htmlPath, htmlInput.html, "utf8");
      let coverPath: string | undefined;
      if (request.cover) {
        const extension = request.cover.mediaType === "image/jpeg" ? "jpg" : "png";
        coverPath = path.join(inputDirectory, `cover.${extension}`);
        await writeFile(coverPath, request.cover.bytes);
      }
      for (const image of htmlInput.images) {
        const imagePath = path.join(inputDirectory, ...image.relativePath.split("/"));
        await mkdir(path.dirname(imagePath), { recursive: true });
        await writeFile(imagePath, image.bytes);
      }

      const epubPath = path.join(outputDirectory, "book.epub");
      const mobiPath = path.join(outputDirectory, "book.mobi");
      const epubBytes = await this.convertFormat(
        htmlPath,
        epubPath,
        "epub",
        request.manuscript.metadata,
        workspace,
        coverPath,
      );
      const mobiBytes = await this.convertFormat(
        htmlPath,
        mobiPath,
        "mobi",
        request.manuscript.metadata,
        workspace,
        coverPath,
      );
      const epubHash = sha256(epubBytes);
      const mobiHash = sha256(mobiBytes);
      const epub: PrivateEpubConversionArtifact = {
        artifactVersion: PRIVATE_ARTIFACT_SCHEMA_VERSION,
        bytes: epubBytes,
        byteLength: epubBytes.byteLength,
        contentHash: epubHash,
        format: "epub",
        mediaType: "application/epub+zip",
        storageKey: `publishing/private/book-versions/${bookVersionId}/conversion-v1/${epubHash}.epub`,
        validation: validateEpub(epubBytes),
        visibility: "private",
      };
      const mobi: PrivateMobiConversionArtifact = {
        artifactVersion: PRIVATE_ARTIFACT_SCHEMA_VERSION,
        bytes: mobiBytes,
        byteLength: mobiBytes.byteLength,
        contentHash: mobiHash,
        format: "mobi",
        mediaType: "application/x-mobipocket-ebook",
        storageKey: `publishing/private/book-versions/${bookVersionId}/conversion-v1/${mobiHash}.mobi`,
        validation: validateLegacyMobi(mobiBytes),
        visibility: "private",
      };

      return {
        artifacts: [epub, mobi],
        bookVersionId,
        conversionVersion: 1,
        createdAt: this.now().toISOString(),
        engine: probe.engine,
        normalizedManuscriptHash: request.manuscript.contentHash,
        schemaVersion: CONVERSION_RESULT_SCHEMA_VERSION,
        sourceArtifactHash: request.manuscript.source.contentHash,
      };
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }
}
