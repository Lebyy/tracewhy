export interface ParsedOptions {
  positionals: string[];
  flags: Map<string, string | boolean>;
  command: string[];
}

const VALUE_FLAGS = new Set([
  "--data-dir", "--output", "--format", "--port", "--max-output-bytes", "--max-trace-bytes",
]);
const BOOLEAN_FLAGS = new Set(["--json", "--no-open", "--overwrite"]);

export function parseOptions(args: string[], splitCommand = false): ParsedOptions {
  const marker = splitCommand ? args.indexOf("--") : -1;
  const optionArgs = marker >= 0 ? args.slice(0, marker) : args;
  const command = marker >= 0 ? args.slice(marker + 1) : [];
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < optionArgs.length; index += 1) {
    const value = optionArgs[index]!;
    if (value.startsWith("--") && value.includes("=")) {
      const [flag, ...rest] = value.split("=");
      if (!flag || !VALUE_FLAGS.has(flag)) throw new Error(`Unknown option: ${flag ?? value}`);
      setFlag(flags, flag, rest.join("="));
    } else if (VALUE_FLAGS.has(value)) {
      const next = optionArgs[index + 1];
      if (!next) throw new Error(`${value} requires a value.`);
      setFlag(flags, value, next);
      index += 1;
    } else if (BOOLEAN_FLAGS.has(value)) {
      setFlag(flags, value, true);
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      positionals.push(value);
    }
  }
  return { positionals, flags, command };
}

function setFlag(flags: Map<string, string | boolean>, name: string, value: string | boolean): void {
  if (flags.has(name)) throw new Error(`Option may only be specified once: ${name}`);
  flags.set(name, value);
}

export function flagString(options: ParsedOptions, name: string): string | undefined {
  const value = options.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function flagBoolean(options: ParsedOptions, name: string): boolean {
  return options.flags.get(name) === true;
}
