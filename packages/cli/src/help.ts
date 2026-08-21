import { createRequire } from "node:module";

import { DEFAULT_GATEWAY_PORT, GATEWAY_PORT_ENV } from "./gateway/service.js";

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
  { flags: "--verbose", text: "show machine ids and extra detail" },
  { flags: "--show-files", text: "list created file paths" },
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
    summary: "legacy alias for the advanced Project builder",
    description:
      "Writes a schemaVersion 2 Project, then guides you through a model, abilities, workspace, and connection. Use `vibekit project create` for the explicit advanced builder; this alias remains for existing scripts.",
    arguments: [{ name: "dir", text: "folder to create (default: current directory)" }],
    options: [
      { flags: "--agent <name>", text: "advanced Agent recipe to include; repeatable (default: General Assistant)" },
      { flags: "--provider <name>", text: "advanced model-service id (default: openai)" },
      { flags: "--model <id>", text: "model id (with --yes, defaults from the catalog if omitted)" },
      { flags: "--interface <name>", text: "advanced connection id (default: terminal; headquarters example uses telegram)" },
      { flags: "--example <name>", text: "scaffold a preset (assistant, coding, headquarters)" },
      { flags: "-y, --yes", text: "skip confirmation prompts" },
      { flags: "--dir <path>", text: "project directory" },
      { flags: "--registry <path>", text: "registry to read from" },
      { flags: "-h, --help", text: "display help for command" },
    ],
    examples: [
      "$ vibekit create my-agent",
      "$ vibekit create my-agent --provider openai --model gpt-5 --yes",
      "$ vibekit create my-app --example assistant --provider openai --yes",
      "$ vibekit create my-code --example coding --provider openai --yes",
      "$ vibekit create my-app --agent chief --agent coder --agent reviewer --yes",
      "$ vibekit create ~/headquarters --example headquarters --yes",
    ],
  },
  {
    name: "setup",
    usage: "setup [options] [dir]",
    summary: "set up this Project and open the primary conversation",
    description:
      "The default path asks for model authentication, chooses the General Assistant with bounded file, command, web-search, and memory abilities, then checks a real conversation before opening the configured connection. Use Customize setup for advanced choices. Rerunning setup preserves existing choices.",
    arguments: [{ name: "dir", text: "Project folder (default: current directory)" }],
    options: [
      { flags: "--customize", text: "choose advanced Agent, ability, workspace, or connection settings" },
      { flags: "--provider <name>", text: "model service id" },
      { flags: "--model <id>", text: "model id" },
      { flags: "--agent <name>", text: "advanced Agent recipe to include; repeatable" },
      { flags: "--interface <name>", text: "advanced connection id" },
      { flags: "-y, --yes", text: "skip confirmation prompts" },
      { flags: "--dir <path>", text: "Project directory" },
      { flags: "--registry <path>", text: "registry to read from" },
      { flags: "-h, --help", text: "display help for command" },
    ],
    examples: [
      "$ vibekit setup",
      "$ vibekit setup --customize",
      "$ vibekit setup --provider openai --model gpt-5 --yes",
    ],
  },
  {
    name: "project",
    usage: "project create [options] [dir]",
    summary: "use the advanced Project builder",
    description:
      "Composes a Project from explicit Agent recipes and Components. Normal setup stays in user language and does not expose this builder's Module assembly.",
    arguments: [{ name: "dir", text: "Project folder to create" }],
    options: [
      { flags: "--agent <name>", text: "Agent recipe to include; repeatable" },
      { flags: "--provider <name>", text: "model service id" },
      { flags: "--model <id>", text: "model id" },
      { flags: "--interface <name>", text: "connection id" },
      { flags: "--example <name>", text: "complete preset (assistant, coding, or chief-led team)" },
      { flags: "-y, --yes", text: "skip confirmation prompts" },
      { flags: "--dir <path>", text: "Project directory" },
      { flags: "--registry <path>", text: "registry to read from" },
      { flags: "-h, --help", text: "display help for command" },
    ],
    examples: ["$ vibekit project create my-agent --provider openai --model gpt-5 --yes"],
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
    name: "config",
    usage: "config effective | secrets [status|set|rotate|remove] | instructions [agent]",
    summary: "inspect Project configuration, manage deployment secrets, or edit Agent instructions",
    description:
      "`effective` shows runtime-normalized configuration. `secrets` manages the owner-only per-Project deployment store without printing values. `instructions` opens the selected Agent's existing instructions.md in your editor.",
    arguments: [{ name: "action", text: "effective, secrets, or instructions" }],
    options: READ_OPTIONS,
    examples: [
      "$ vibekit config effective",
      "$ vibekit config secrets status",
      "$ vibekit config secrets set OPENAI_API_KEY",
      "$ vibekit config instructions",
    ],
  },
  {
    name: "connect",
    usage: "connect telegram [options]",
    summary: "connect Telegram and guide the first sender pairing",
    description:
      "Stores the Telegram bot token in the owner-only deployment store, enables only Telegram for this Project, keeps the Host running, and guides the first verified sender into the visible owner identity.",
    arguments: [{ name: "channel", text: "telegram" }],
    options: READ_OPTIONS,
    examples: ["$ vibekit connect telegram"],
  },
  {
    name: "msg",
    usage: "msg [options] <text>",
    summary: "send one message through the configured Project",
    description:
      "Sends one turn on the local conversation and prints the response. VibeKit keeps an enabled connection available when it needs to receive messages over time. Does not launch the Pi TUI.",
    arguments: [{ name: "text", text: "message to send" }],
    options: READ_OPTIONS,
    examples: ["$ vibekit msg \"Hello\""],
  },
  {
    name: "start",
    usage: "start [options]",
    summary: "make VibeKit ready for this Project",
    description:
      "Starts this Project in the background so its configured connections can receive messages. Use --foreground only for an attached operator session.",
    options: [
      { flags: "-f, --foreground", text: "run attached in foreground instead of detached" },
      { flags: "-y, --yes", text: "skip confirmation prompts" },
      { flags: "--dir <path>", text: "project directory (default: current directory)" },
      { flags: "--registry <path>", text: "registry to read from (default: official)" },
      { flags: "-h, --help", text: "display help for command" },
    ],
    examples: [
      "$ vibekit start",
      "$ vibekit start --foreground",
      "$ vibekit start --dir ./my-agent",
    ],
  },
  {
    name: "status",
    usage: "status [options]",
    summary: "show whether VibeKit is ready",
    description:
      "Summarizes the installation, Project, model sign-in, connections, background availability, dashboard, and latest Doctor result in user language. Use --verbose for machine details.",
    options: READ_OPTIONS,
    examples: ["$ vibekit status"],
  },
  {
    name: "stop",
    usage: "stop [options]",
    summary: "pause VibeKit for this Project",
    description:
      "Stops the active Project connections and conversations without deleting the Project, State, sessions, or secrets. Start it again whenever you need it.",
    options: READ_OPTIONS,
    examples: ["$ vibekit stop", "$ vibekit stop --dir ./my-agent"],
  },
  {
    name: "projects",
    usage: "projects add <path> | list | remove <project-id> | locate <project-id> <path>",
    summary: "manage the machine-local Project registry",
    description: "Registers existing Projects by canonical path. Removing an entry never deletes Project files, State, sessions, or secrets.",
    options: [{ flags: "-h, --help", text: "display help for command" }],
    examples: ["$ vibekit projects add ~/Projects/my-agent", "$ vibekit projects list"],
  },
  {
    name: "gateway",
    usage: "gateway install|uninstall|start|stop|restart|status|run [--port <port>]",
    summary: "manage the local Project Gateway",
    description: "Runs one loopback-only dashboard and lifecycle API. The Gateway never combines Project context and never automatically restarts Project Hosts.",
    options: [{ flags: "--port <port>", text: `Gateway port (--port, ${GATEWAY_PORT_ENV}, persisted setting, or ${DEFAULT_GATEWAY_PORT})` }, { flags: "-h, --help", text: "display help for command" }],
    examples: ["$ vibekit gateway install", `$ ${GATEWAY_PORT_ENV}=9583 vibekit gateway install`, `$ vibekit gateway run --port ${DEFAULT_GATEWAY_PORT}`],
  },
  {
    name: "dashboard",
    usage: "dashboard [--port <port>]",
    summary: "open the local Project dashboard",
    options: [{ flags: "--port <port>", text: `Gateway port (--port, ${GATEWAY_PORT_ENV}, persisted setting, or ${DEFAULT_GATEWAY_PORT})` }, { flags: "-h, --help", text: "display help for command" }],
    examples: ["$ vibekit dashboard"],
  },
  {
    name: "migrate",
    usage: "migrate [options]",
    summary: "upgrade an older Project to the current format",
    options: COMMAND_OPTIONS,
    examples: ["$ vibekit migrate --yes"],
  },
  {
    name: "init",
    usage: "init [options] [dir]",
    summary: "initialize a Project and walk through setup",
    description:
      "Writes .vibekit/project.yaml and installed.json, then walks through a keyboard-native setup using model, abilities, workspace, and connection language. Advanced flags can select Agent recipes and Components directly. Pass flags to skip the wizard, or --defaults for an empty Project.",
    arguments: [
      { name: "dir", text: "folder to initialize (default: current directory)" },
    ],
    options: [
      { flags: "-d, --defaults", text: "skip the setup wizard and use an empty Project" },
      { flags: "-y, --yes", text: "same as --defaults unless setup flags are passed" },
      { flags: "--provider <name>", text: "provider id" },
      { flags: "--model <id>", text: "model id (requires --provider)" },
      { flags: "--agent <name>", text: "advanced Agent recipe to include; repeatable" },
      { flags: "--interface <name>", text: "advanced connection id (flag installs one)" },
      { flags: "--skill <name>", text: "install a Skill explicitly; advanced and repeatable" },
      { flags: "--policy <name>", text: "install a Project Policy explicitly; advanced and repeatable" },
      { flags: "--tool <name>", text: "install a Tool explicitly; advanced and repeatable" },
      { flags: "--verbose", text: "show machine ids in the summary" },
      { flags: "--show-files", text: "list created file paths" },
      { flags: "--registry <path>", text: "registry to read from (default: official)" },
      { flags: "-h, --help", text: "display help for command" },
    ],
    examples: [
      "$ vibekit init",
      "$ vibekit init ./my-app",
      "$ vibekit init --defaults",
      "$ vibekit init --provider openai --model gpt-5 --agent chief --agent coder --agent reviewer --interface terminal --policy least-privilege --policy require-verification",
    ],
  },
  {
    name: "add",
    usage: "add [options] <type> <name>",
    summary: "add a Component or Agent from the selected registry",
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
    usage: "update [options] <module> [module...]",
    summary: "update a Module with a three-way compare",
    description:
      "Keeps your edits when upstream did not change. Multiple mutually dependent Modules are updated atomically so package constraints are solved together. Stops the whole update if both you and upstream changed the same file. There is no --force.",
    arguments: [
      {
        name: "module...",
        text: "one or more Module IDs, optionally pinned as type:name@version",
      },
    ],
    options: COMMAND_OPTIONS,
    examples: [
      "$ vibekit update agent:coder --yes",
      "$ vibekit update tool:github@1.1.0 --yes",
      "$ vibekit update state:memory tool:memory --yes",
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
    name: "approve-pairing",
    usage: "approve-pairing [options] <code>",
    summary: "approve a Telegram pairing code from an unknown sender",
    arguments: [{ name: "code", text: "8-character pairing code from the bot" }],
    options: READ_OPTIONS,
    examples: ["$ vibekit approve-pairing 7K3M9P2Q"],
  },
  {
    name: "doctor",
    usage: "doctor [options]",
    summary: "check that the Project, Modules, and ownership still line up",
    description:
      "Reports contract, runtime, provider, Interface, and release problems. --fix applies only explicit, mechanically provable repairs such as generated paths, owner-only modes, derived configuration, and stale locks.",
    options: [
      ...READ_OPTIONS,
      { flags: "--fix", text: "apply safe mechanical repairs; refuse local or consequential changes" },
    ],
    examples: ["$ vibekit doctor", "$ vibekit doctor --fix", "$ vibekit doctor --dir ./my-app --fix"],
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
  // The legacy builder plus service and registry controls remain available
  // through `help <command>` but stay out of the primary product menu.
  const commands = COMMANDS.filter((command) =>
    command.name !== "help" &&
    command.name !== "create" &&
    command.name !== "gateway" &&
    command.name !== "projects",
  );
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
    "run your VibeKit Project and its configured connections",
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
