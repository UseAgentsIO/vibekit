import { createRequire } from "node:module";

export interface CommandHelp {
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  readonly description?: string;
  readonly arguments?: ReadonlyArray<{ readonly name: string; readonly text: string }>;
  readonly options: ReadonlyArray<{ readonly flags: string; readonly text: string }>;
  readonly examples?: readonly string[];
}

const GLOBAL_OPTIONS: CommandHelp["options"] = [
  { flags: "-y, --yes", text: "skip confirmation prompts" },
  { flags: "-d, --defaults", text: "use defaults and skip the setup wizard" },
  { flags: "--dir <path>", text: "project directory (default: current directory)" },
  { flags: "--registry <path>", text: "registry to read from (default: official)" },
  { flags: "-v, --version", text: "print the version number" },
  { flags: "-h, --help", text: "display help for command" },
];

const COMMAND_OPTIONS: CommandHelp["options"] = [
  { flags: "-y, --yes", text: "skip confirmation prompts" },
  { flags: "--dir <path>", text: "project directory (default: current directory)" },
  { flags: "--registry <path>", text: "registry to read from (default: official)" },
  { flags: "-h, --help", text: "display help for command" },
];

const READ_OPTIONS: CommandHelp["options"] = [
  { flags: "--dir <path>", text: "project directory (default: current directory)" },
  { flags: "--registry <path>", text: "registry to read from (default: official)" },
  { flags: "-h, --help", text: "display help for command" },
];

export const COMMANDS: readonly CommandHelp[] = [
  {
    name: "create",
    usage: "create [options] [dir]",
    summary: "create a runnable Agent Project",
    description:
      "Writes a schemaVersion 2 Project, installs the selected Agent, and configures a terminal Interface. Message the Agent with `vibekit msg`.",
    arguments: [{ name: "dir", text: "folder to create (default: current directory)" }],
    options: [
      { flags: "--agent <name>", text: "starter Agent (default: chief)" },
      { flags: "--provider <name>", text: "provider id (default: openai)" },
      { flags: "--model <id>", text: "model id (required with --yes; otherwise pick from the live list)" },
      { flags: "--interface <name>", text: "Interface (default: terminal)" },
      { flags: "-y, --yes", text: "skip confirmation prompts" },
      { flags: "--dir <path>", text: "project directory" },
      { flags: "--registry <path>", text: "registry to read from" },
      { flags: "-h, --help", text: "display help for command" },
    ],
    examples: [
      "$ vibekit create my-agent",
      "$ vibekit create my-agent --provider openai --model gpt-5 --yes",
    ],
  },
  {
    name: "model",
    usage: "model [options] [provider/id]",
    summary: "pick the Project model from Pi's live catalog",
    description:
      "Lists models for the selected provider from Pi. Writes defaults.model. No hardcoded model ids.",
    arguments: [
      { name: "provider/id", text: "optional explicit pair, for example openai/gpt-5" },
    ],
    options: [
      { flags: "--provider <name>", text: "provider id" },
      { flags: "--model <id>", text: "model id" },
      { flags: "--dir <path>", text: "project directory (default: current directory)" },
      { flags: "-y, --yes", text: "require --provider and --model; do not prompt" },
      { flags: "-h, --help", text: "display help for command" },
    ],
    examples: ["$ vibekit model", "$ vibekit model --provider openai --model gpt-5 --yes"],
  },
  {
    name: "msg",
    usage: "msg [options] <text>",
    summary: "send one message through the Host to the configured provider",
    description:
      "Starts the Host in-process, sends one turn on the local CLI conversation, prints the response, and stops. Does not launch the Pi TUI.",
    arguments: [{ name: "text", text: "message to send" }],
    options: READ_OPTIONS,
    examples: ["$ vibekit msg \"Hello\""],
  },
  {
    name: "start",
    usage: "start [options]",
    summary: "start the Host in the foreground with the terminal Interface",
    description: "Development path. The Host stays alive until you exit.",
    options: READ_OPTIONS,
    examples: ["$ vibekit start"],
  },
  {
    name: "status",
    usage: "status [options]",
    summary: "show Project, Interface, and Host status",
    options: READ_OPTIONS,
    examples: ["$ vibekit status"],
  },
  {
    name: "migrate",
    usage: "migrate [options]",
    summary: "upgrade a schemaVersion 1 Project to Host-aware schemaVersion 2",
    options: COMMAND_OPTIONS,
    examples: ["$ vibekit migrate --yes"],
  },
  {
    name: "init",
    usage: "init [options] [dir]",
    summary: "initialize a Project and walk through setup",
    description:
      "Writes .vibekit/project.yaml and installed.json, then asks which provider, Agent, Interface, Skill, Policy, and Tool to add. Each step can be skipped. Pass --defaults to skip setup, like shadcn init -d.",
    arguments: [
      { name: "dir", text: "folder to initialize (default: current directory)" },
    ],
    options: [
      { flags: "-d, --defaults", text: "skip the setup wizard and use an empty Project" },
      { flags: "-y, --yes", text: "same as --defaults" },
      { flags: "--registry <path>", text: "registry to read from (default: official)" },
      { flags: "-h, --help", text: "display help for command" },
    ],
    examples: [
      "$ vibekit init",
      "$ vibekit init ./my-app",
      "$ vibekit init --defaults",
    ],
  },
  {
    name: "add",
    usage: "add [options] <type> <name>",
    summary: "add a Component or Agent from the official registry",
    description:
      "Resolves required dependencies, shows requested permissions, then copies the files into your project. You own everything that is added.",
    arguments: [
      {
        name: "type",
        text: "provider | tool | skill | interface | state | policy | verifier | agent",
      },
      { name: "name", text: "module name, for example opencode-go or coder" },
    ],
    options: COMMAND_OPTIONS,
    examples: [
      "$ vibekit add provider opencode-go --yes",
      "$ vibekit add agent coder --yes",
      "$ vibekit add tool github --yes",
    ],
  },
  {
    name: "list",
    usage: "list [options]",
    summary: "list installed Modules and what the registry can still add",
    description:
      "Shows four separate statuses for each Module: installed, configured, available, and verified.",
    options: READ_OPTIONS,
    examples: ["$ vibekit list", "$ vibekit list --dir ./my-app"],
  },
  {
    name: "diff",
    usage: "diff [options] <module>",
    summary: "show local edits against the installed and newest registry versions",
    description:
      "Read-only. Compares the copy you have, the version you installed, and the newest compatible registry version. Does not write files.",
    arguments: [
      {
        name: "module",
        text: "module id such as agent:coder, or type name such as agent coder",
      },
    ],
    options: READ_OPTIONS,
    examples: ["$ vibekit diff agent:coder", "$ vibekit diff tool github"],
  },
  {
    name: "update",
    usage: "update [options] <module>",
    summary: "update a Module with a three-way compare",
    description:
      "Keeps your edits when upstream did not change. Stops the whole Module if both you and upstream changed the same file. There is no --force.",
    arguments: [
      {
        name: "module",
        text: "module id, optionally pinned as type:name@version",
      },
    ],
    options: COMMAND_OPTIONS,
    examples: [
      "$ vibekit update agent:coder --yes",
      "$ vibekit update tool:github@1.1.0 --yes",
    ],
  },
  {
    name: "remove",
    usage: "remove [options] <module>",
    summary: "remove a Module without deleting your local edits",
    description:
      "Unchanged exclusive files may be deleted. Modified files stop removal. Shared dependencies used by another Module stay installed.",
    arguments: [
      { name: "module", text: "module id such as skill:research" },
    ],
    options: COMMAND_OPTIONS,
    examples: ["$ vibekit remove skill:research --yes"],
  },
  {
    name: "doctor",
    usage: "doctor [options]",
    summary: "check that the Project, Modules, and ownership still line up",
    description:
      "Reports schema, dependency, conflict, and ownership problems. Does not silently repair consequential issues.",
    options: READ_OPTIONS,
    examples: ["$ vibekit doctor", "$ vibekit doctor --dir ./my-app"],
  },
  {
    name: "help",
    usage: "help [command]",
    summary: "display help for command",
    arguments: [{ name: "command", text: "command to explain (default: this overview)" }],
    options: [{ flags: "-h, --help", text: "display help for command" }],
  },
];

export function cliVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json") as { version: string };
  return pkg.version;
}

export function findCommand(name: string | undefined): CommandHelp | undefined {
  if (!name) {
    return undefined;
  }
  return COMMANDS.find((command) => command.name === name);
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function section(
  title: string,
  rows: ReadonlyArray<{ readonly left: string; readonly right: string }>,
): string {
  const width = rows.reduce((max, row) => Math.max(max, row.left.length), 0);
  const lines = rows.map((row) => `  ${pad(row.left, width)}  ${row.right}`);
  return `${title}:\n${lines.join("\n")}`;
}

export function formatRootHelp(): string {
  const commands = COMMANDS.filter((command) => command.name !== "help");
  const commandRows = [
    ...commands.map((command) => ({
      left: command.usage,
      right: command.summary,
    })),
    { left: "help [command]", right: "display help for command" },
  ];
  return [
    "Usage: vibekit [options] [command]",
    "",
    "run an Agent Host; compose Agents and Components",
    "",
    section(
      "Options",
      GLOBAL_OPTIONS.map((option) => ({ left: option.flags, right: option.text })),
    ),
    "",
    section("Commands", commandRows),
    "",
  ].join("\n");
}

export function formatCommandHelp(command: CommandHelp): string {
  const blocks = [
    `Usage: vibekit ${command.usage}`,
    "",
    command.summary,
  ];
  if (command.description) {
    blocks.push("", command.description);
  }
  if (command.arguments && command.arguments.length > 0) {
    blocks.push(
      "",
      section(
        "Arguments",
        command.arguments.map((argument) => ({ left: argument.name, right: argument.text })),
      ),
    );
  }
  if (command.options.length > 0) {
    blocks.push(
      "",
      section(
        "Options",
        command.options.map((option) => ({ left: option.flags, right: option.text })),
      ),
    );
  }
  if (command.examples && command.examples.length > 0) {
    blocks.push("", "Examples:", ...command.examples.map((example) => `  ${example}`));
  }
  blocks.push("");
  return blocks.join("\n");
}

export function formatUnknownCommand(name: string): string {
  return `Unknown command "${name}"\n\n${formatRootHelp()}`;
}
