// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Solutions Unity

// Tree-wide process control — house mechanism, no
// dependency. Agents and brokered terminals spawn as process-group leaders
// on POSIX (`detached`), so stopping one stops everything it shelled out to
// — grandchildren included (an agent's own mcp-server/bridge children, a
// terminal's test runner). Windows has no process groups: `taskkill /T`
// walks the tree instead, and has no signal concept, so the graceful rung
// collapses into the forced one there. vscode-free, like pool.ts, so all of
// it is unit-testable against real spawned processes.
import { type ChildProcess, execFile, type SpawnOptions } from "node:child_process";

/** Spread into `spawn` options: POSIX children lead their own process
 * group (that's what makes `kill(-pid)` reach the whole tree). stdio stays
 * piped, so `detached` changes group membership only — nothing else. */
export const treeSpawnOptions: Pick<SpawnOptions, "detached"> =
  process.platform === "win32" ? {} : { detached: true };

/** Signals the tree of a process this host spawned. A pid is this host's
 * only while it holds the process — until its exit lands; after that the
 * system may already have given the pid to another process (Windows does
 * so at once), and a kill by it would end that one, tree and all. So a
 * running process's whole tree goes; an exited one's only what can still
 * be reached safely: on POSIX the group its survivors are in (a group id
 * is never reused while the group has members), on Windows nothing — a
 * dead root has no tree taskkill can walk. Fire-and-forget on Windows
 * (taskkill is a subprocess). Every caller is on a "make it dead" path
 * where a gone tree is success, never an error. */
export function killTree(child: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void {
  const pid = child.pid;
  if (pid === undefined) return;
  const held = child.exitCode === null && child.signalCode === null;
  if (held) killPidTree(pid, signal);
  else if (process.platform !== "win32") signalGroup(pid, signal);
}

/** The tree rooted at `pid`, by the pid alone — for a process whose pid is
 * known to be the one meant: one held, or an orphan whose command line was
 * just read back as the one recorded. */
function killPidTree(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {});
    return;
  }
  // Group already gone (or the leader never became one — spawn raced its
  // own failure): the bare pid, still the one meant.
  if (!signalGroup(pid, signal)) {
    try {
      process.kill(pid, signal);
    } catch {
      /* already dead — the desired state */
    }
  }
}

/** Signals the POSIX process group `pgid`; false when there is none. */
function signalGroup(pgid: number, signal: "SIGTERM" | "SIGKILL"): boolean {
  try {
    process.kill(-pgid, signal); // negative pid = the whole group
    return true;
  } catch {
    return false;
  }
}

/** A process this host spawned, as its bookkeeping sees it — whatever
 * spawned it (an agent's connection, a terminal). */
export interface TrackedProcess {
  readonly pid: number;
  /** True until its exit has been observed. */
  running(): boolean;
  onExit(listener: () => void): void;
}

/** `child` as a `TrackedProcess`; null when it never got a pid (its spawn
 * failed). */
export function trackedChild(child: ChildProcess): TrackedProcess | null {
  const pid = child.pid;
  if (pid === undefined) return null;
  return {
    pid,
    running: () => child.exitCode === null && child.signalCode === null,
    onExit: (listener) => void child.once("exit", listener),
  };
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The live command line of `pid`, "" when the process is gone or the read
 * fails. Read once right after spawn (record what reality says) and again
 * at reap time (compare with what reality says now) — the PID-reuse guard:
 * a mismatch means this pid is somebody else now, and the only safe move is
 * to spare it. */
export async function commandOf(pid: number): Promise<string> {
  return (await commandsOf([pid])).get(pid) ?? "";
}

/** The live command line of each of `pids`, in one read of the OS however
 * many there are (on Windows each read is a PowerShell process — the cost
 * worth sharing). A pid that is gone, or whose line can't be read, is
 * absent. */
export function commandsOf(pids: readonly number[]): Promise<Map<number, string>> {
  const lines = new Map<number, string>();
  if (pids.length === 0) return Promise.resolve(lines);
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const filter = pids.map((pid) => `ProcessId=${pid}`).join(" OR ");
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId, CommandLine)`,
        ],
        (_err, stdout) => {
          try {
            for (const row of JSON.parse(stdout) as { ProcessId: number; CommandLine: string | null }[]) {
              const line = row.CommandLine?.trim() ?? "";
              if (line !== "") lines.set(row.ProcessId, line);
            }
          } catch {
            /* no answer — every pid reads as unreadable */
          }
          resolve(lines);
        },
      );
      return;
    }
    // `ps` lists what it found and fails only when it found none.
    execFile("ps", ["-o", "pid=,args=", "-p", pids.join(",")], (_err, stdout) => {
      for (const row of stdout.split("\n")) {
        const match = /^\s*(\d+)\s+(.*\S)/.exec(row);
        if (match !== null) lines.set(Number(match[1]), match[2]!);
      }
      resolve(lines);
    });
  });
}

export interface OrphanRecord {
  pid: number;
  /** As `commandOf` reported it right after spawn. */
  command: string;
}

/** Reaps leftovers from a session that never ran its cleanup:
 * SIGKILLs the tree of every record whose pid is alive *and* still runs the
 * recorded command line — `running` is what `commandsOf` read of them just
 * now; a mismatch is a reused pid and is spared. Returns what happened per
 * record so the caller can log it and drop them all — dead, killed, or
 * spared, the record itself is spent either way. Generic so callers get
 * their own record type back (the spawn registry logs `kind`). */
export function reapOrphans<T extends OrphanRecord>(
  records: readonly T[],
  running: ReadonlyMap<number, string>,
): { killed: T[]; spared: T[] } {
  const killed: T[] = [];
  const spared: T[] = [];
  for (const record of records) {
    if (!isAlive(record.pid)) continue; // already gone — nothing to do
    if (running.get(record.pid) === record.command) {
      killPidTree(record.pid, "SIGKILL");
      killed.push(record);
    } else {
      spared.push(record);
    }
  }
  return { killed, spared };
}
