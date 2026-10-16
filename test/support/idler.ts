// A process of this Node that idles until killed — a stand-in for anything
// long-running a test needs alive: an agent, a terminal, a window's
// extension host.
import { type ChildProcess, spawn } from "node:child_process";
import { treeSpawnOptions } from "../../src/orchestrator/process-tree";

/** The script it runs: idle until killed. */
export const IDLE = "setInterval(() => {}, 1 << 30)";

/** `marker` rides its command line, so a read of that line can tell it
 * from any other. A tree leader unless told otherwise — as everything
 * patchbay spawns is. */
export function idler(marker: string, { treeLeader = true } = {}): ChildProcess {
  return spawn(process.execPath, ["-e", IDLE, marker], {
    stdio: "ignore",
    ...(treeLeader ? treeSpawnOptions : {}),
  });
}
