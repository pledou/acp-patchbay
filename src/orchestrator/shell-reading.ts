// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Solutions Unity

// Reads what a command line runs: every command in it, wherever it sits —
// in a chain, a pipeline, a loop body, a subshell, a function — and every
// part whose commands can't be known from the text. One reading for every
// command patchbay judges: a run handed over as argv, and a shell line.
//
// The line is parsed by tree-sitter's bash grammar, run as WebAssembly —
// the parser Gemini CLI and Codex use for the same job. Only bash is read:
// a line for another shell is unreadable, and so asks. Plain argv needs no
// parser at all — the grammar loads the first time a shell script shows up.
import { join } from "node:path";
import { Language, type Node, Parser } from "@vscode/tree-sitter-wasm";
import { quoteArg } from "../shared/command-line";

/** One command the line runs: its words as the command receives them —
 * quotes removed, a part only known when it runs as written — and the
 * command as a person reads it, the text a command rule matches. */
export interface ReadCommand {
  text: string;
  words: readonly string[];
}

/** A part of the line whose commands can't be seen from its text, and
 * why. */
export interface UnreadPart {
  text: string;
  reason: string;
}

export interface ShellReading {
  commands: readonly ReadCommand[];
  unreadable: readonly UnreadPart[];
}

/** A word and whether its value is known from the text. */
interface Word {
  value: string;
  literal: boolean;
}

/** Shells whose `-c` script is read as bash: the grammar is bash, and sh
 * and dash speak a subset of it. */
const BASH = new Set(["bash", "sh", "dash"]);
/** Shells whose scripts this reader can't follow. */
const OTHER_SHELLS = new Set(["zsh", "ksh", "mksh", "fish", "csh", "tcsh", "pwsh", "powershell", "cmd"]);

function isShell(word: string): boolean {
  const name = programName(word);
  return BASH.has(name) || OTHER_SHELLS.has(name);
}

/** A program's own name: its path and a Windows `.exe` left off. */
export function programName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? word).replace(/\.exe$/i, "");
}

const parsers = new Map<string, Promise<Parser | null>>();

/** The bash parser, loaded once per process from `grammarDir`; null when
 * it can't load — every script then reads as unreadable, and asks. */
function bashParser(grammarDir: string): Promise<Parser | null> {
  let loading = parsers.get(grammarDir);
  if (loading === undefined) {
    loading = (async () => {
      await Parser.init({ locateFile: (file: string) => join(grammarDir, file) });
      const parser = new Parser();
      parser.setLanguage(await Language.load(join(grammarDir, "tree-sitter-bash.wasm")));
      return parser;
    })().catch(() => null);
    parsers.set(grammarDir, loading);
  }
  return loading;
}

export class ShellReader {
  /** `grammarDir` holds `tree-sitter.wasm` and `tree-sitter-bash.wasm`. */
  constructor(private readonly grammarDir: string) {}

  /** A program run with its arguments, no shell between — each argument
   * is one word, whatever it holds. A shell among them is read through:
   * which shell reads a line is only ever known from the program that
   * will run it. */
  async readRun(command: string, args: readonly string[]): Promise<ShellReading> {
    const words = [command, ...args].map((value) => ({ value, literal: true }));
    const reading = new Reading(words.some((w) => isShell(w.value)) ? await bashParser(this.grammarDir) : null);
    reading.run(words);
    return reading.result();
  }
}

class Reading {
  private readonly commands: ReadCommand[] = [];
  private readonly unreadable: UnreadPart[] = [];

  constructor(private readonly parser: Parser | null) {}

  result(): ShellReading {
    return { commands: this.commands, unreadable: this.unreadable };
  }

  script(text: string): void {
    const tree = this.parser?.parse(text) ?? null;
    if (tree === null) {
      this.unreadable.push({ text, reason: "the bash reader didn't load" });
      return;
    }
    try {
      if (tree.rootNode.hasError) this.unreadable.push({ text, reason: "not bash this reader can follow" });
      this.walk(tree.rootNode);
    } finally {
      tree.delete();
    }
  }

  /** A program and its words: judged as itself — unless it is a shell
   * handed a script, which is transparent: the script's commands are what
   * run. A bash further along (`sudo bash -c …`) is read through too; any
   * other shell started here asks — its scripts aren't read. */
  run(words: readonly Word[]): void {
    const at = words.findIndex((w) => w.literal && isShell(w.value));
    if (at === -1) {
      this.commands.push(commandOf(words));
      return;
    }
    const shell = words.slice(at);
    const name = programName(shell[0]!.value);
    const text = shell.map(textOf).join(" ");
    if (!BASH.has(name)) {
      if (at === 0) this.unreadable.push({ text, reason: `a ${name} script — only bash is read` });
      else this.commands.push(commandOf(words));
      return;
    }
    const script = scriptOf(shell, at === 0);
    if (at !== 0 || script?.kind === "file") this.commands.push(commandOf(words));
    if (script === null || script.kind === "file") return;
    if (script.kind === "input") this.unreadable.push({ text, reason: `${name} reads its commands from its input` });
    else if (!script.script.literal) this.unreadable.push({ text, reason: "the script is only known when it runs" });
    else this.script(script.script.value);
  }

  private walk(node: Node): void {
    switch (node.type) {
      case "command":
        this.command(node);
        return;
      case "declaration_command":
      case "unset_command":
        this.declaration(node);
        return;
      case "command_substitution":
      case "process_substitution":
        this.unreadable.push({ text: node.text, reason: "a command substitution — its output is only known when it runs" });
        return;
      default:
        for (const child of node.namedChildren) if (child !== null) this.walk(child);
    }
  }

  private command(node: Node): void {
    const name = node.childForFieldName("name");
    const args = node.childrenForFieldName("argument").filter((n) => n !== null);
    // Assignments and redirects run nothing themselves; what they hold may.
    for (const child of node.namedChildren) {
      if (child !== null && child.type !== "command_name") this.walk(child);
    }
    const head = name?.namedChildren[0] ?? null;
    if (head === null) return;
    this.walk(head);
    const program = wordOf(head);
    if (!program.literal) {
      this.unreadable.push({ text: node.text, reason: "the command's name is only known when it runs" });
      return;
    }
    if (program.value === "eval") {
      this.unreadable.push({ text: node.text, reason: "eval runs its arguments as a command" });
      return;
    }
    this.run([program, ...args.map(wordOf)]);
  }

  /** `export`, `declare`, `unset` and their kin: a command named by its
   * keyword. */
  private declaration(node: Node): void {
    const keyword = node.child(0)?.text ?? "";
    const words = node.namedChildren.filter((n) => n !== null);
    for (const word of words) this.walk(word);
    this.run([{ value: keyword, literal: true }, ...words.map(wordOf)]);
  }
}

/** What a shell's words ask it to run: a script handed inline (`-c`), a
 * script file, or whatever arrives on its input. A shell further along the
 * words counts only when it is handed a script there — `echo bash` is an
 * argument, not a shell: null. */
function scriptOf(shell: readonly Word[], atStart: boolean): { kind: "inline"; script: Word } | { kind: "file" } | { kind: "input" } | null {
  let inline = false;
  let stdin = false;
  let i = 1;
  for (; i < shell.length; i++) {
    const flag = shell[i]!.value;
    if (flag === "--") {
      i++;
      break;
    }
    if (!/^[-+]./.test(flag)) break;
    if (flag.startsWith("--")) continue;
    if (/^[-+][oO]$/.test(flag)) {
      i++; // the option's own name follows
      continue;
    }
    if (flag.startsWith("-") && flag.includes("c")) inline = true;
    if (flag.startsWith("-") && flag.includes("s")) stdin = true;
  }
  const operand = shell[i];
  if (inline && operand !== undefined) return { kind: "inline", script: operand };
  if (inline || stdin) return { kind: "input" };
  if (!atStart) return null;
  return operand === undefined ? { kind: "input" } : { kind: "file" };
}

function commandOf(words: readonly Word[]): ReadCommand {
  return { text: words.map(textOf).join(" "), words: words.map((w) => w.value) };
}

/** A word as a person reads it: a known value quoted the way a command
 * line writes it, a computed one as written. */
function textOf(word: Word): string {
  return word.literal ? quoteArg(word.value) : word.value;
}

/** A word's value, where the text alone says it. */
function wordOf(node: Node): Word {
  const computed = { value: node.text, literal: false };
  switch (node.type) {
    case "word":
    case "number":
      return { value: node.text.replace(/\\(.)/gs, "$1"), literal: true };
    case "raw_string":
      return { value: node.text.slice(1, -1), literal: true };
    case "string": {
      const parts = node.namedChildren;
      if (!parts.every((p) => p?.type === "string_content")) return computed;
      return { value: parts.map((p) => p!.text.replace(/\\([\\"$`])/g, "$1")).join(""), literal: true };
    }
    case "concatenation": {
      const parts = node.namedChildren.filter((n) => n !== null).map(wordOf);
      return parts.every((p) => p.literal) ? { value: parts.map((p) => p.value).join(""), literal: true } : computed;
    }
    case "variable_assignment": {
      const name = node.childForFieldName("name")?.text ?? "";
      const value = node.childForFieldName("value");
      if (value === null) return { value: `${name}=`, literal: true };
      const read = wordOf(value);
      return read.literal ? { value: `${name}=${read.value}`, literal: true } : computed;
    }
    default:
      return computed;
  }
}
