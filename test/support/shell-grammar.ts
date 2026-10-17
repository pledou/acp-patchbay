import { join } from "node:path";

/** The bash grammar where the package installs it — the build copies the
 * same two files beside the bundle. */
export const SHELL_GRAMMAR = join(process.cwd(), "node_modules", "@vscode", "tree-sitter-wasm", "wasm");
