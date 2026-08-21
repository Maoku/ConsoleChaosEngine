import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

const SAFE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;

function quoteArgument(argument) {
  const value = String(argument);
  if (SAFE_ARGUMENT.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function formatCommand(command, args) {
  return [command, ...args].map(quoteArgument).join(" ");
}

function elapsedSeconds(startedAt) {
  return `${((Date.now() - startedAt) / 1000).toFixed(2)}s`;
}

export class DistributionCommandError extends Error {
  constructor({ label, command, args, cwd, status, signal, cause }) {
    const outcome =
      status === null
        ? signal
          ? `signal ${signal}`
          : "an unknown status"
        : `exit code ${status}`;
    super(`${label} failed with ${outcome}`, cause ? { cause } : undefined);
    this.name = "DistributionCommandError";
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.status = status;
    this.signal = signal;
  }
}

export async function createDistributionDiagnostics({ logPath, title }) {
  await mkdir(dirname(logPath), { recursive: true });
  const logFile = await open(logPath, "w");
  let pendingWrite = Promise.resolve();
  let writeFailure;

  function append(chunk) {
    pendingWrite = pendingWrite.then(async () => {
      if (writeFailure) return;
      try {
        await logFile.write(chunk);
      } catch (error) {
        writeFailure = error;
      }
    });
  }

  function line(level, message, destination = process.stdout) {
    const output = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    destination.write(output);
    append(output);
  }

  function output(stream, chunk) {
    const destination = stream === "stderr" ? process.stderr : process.stdout;
    destination.write(chunk);
    append(chunk);
  }

  const diagnostics = {
    logPath,
    info(message) {
      line("INFO", message);
    },
    success(message) {
      line("OK", message);
    },
    error(message) {
      line("ERROR", message, process.stderr);
    },
    reportFailure(error) {
      const detail =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      line("ERROR", `Distribution task failed:\n${detail}`, process.stderr);
      line("ERROR", `Full diagnostic log: ${logPath}`, process.stderr);
    },
    async run(command, args, { cwd, label }) {
      const startedAt = Date.now();
      line("STEP", `▶ ${label}`);
      line("INFO", `Working directory: ${cwd}`);
      line("CMD", `$ ${formatCommand(command, args)}`);

      return await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let spawnFailure;
        let sawOutput = false;
        let outputEndsWithNewline = true;

        const forward = (stream, chunk) => {
          sawOutput = true;
          outputEndsWithNewline = chunk.at(-1) === 10;
          output(stream, chunk);
        };
        child.stdout.on("data", (chunk) => forward("stdout", chunk));
        child.stderr.on("data", (chunk) => forward("stderr", chunk));
        child.once("error", (error) => {
          spawnFailure = error;
        });
        child.once("close", (status, signal) => {
          if (sawOutput && !outputEndsWithNewline) output("stdout", "\n");
          const duration = elapsedSeconds(startedAt);
          if (status === 0 && !spawnFailure) {
            line("OK", `✓ ${label} (${duration})`);
            resolve();
            return;
          }

          const failure = new DistributionCommandError({
            label,
            command,
            args,
            cwd,
            status,
            signal,
            cause: spawnFailure,
          });
          line("ERROR", `✗ ${failure.message} (${duration})`, process.stderr);
          if (spawnFailure) {
            line(
              "ERROR",
              `Unable to start command: ${spawnFailure.message}`,
              process.stderr,
            );
          }
          reject(failure);
        });
      });
    },
    async close() {
      await pendingWrite;
      await logFile.close();
      if (writeFailure) throw writeFailure;
    },
  };

  diagnostics.info(title);
  diagnostics.info(
    `Node.js: ${process.version} (${process.platform}/${process.arch})`,
  );
  diagnostics.info(`Diagnostic log: ${logPath}`);
  return diagnostics;
}

export function exitCodeFor(error) {
  return error instanceof DistributionCommandError &&
    Number.isInteger(error.status) &&
    error.status > 0 &&
    error.status <= 255
    ? error.status
    : 1;
}
