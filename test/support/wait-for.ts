/** How long a wait gives its condition, and how often it looks: one budget
 * for every wait in the suite. What a test waits on mostly arrives from a
 * subprocess, which a loaded machine (Windows under the full suite) slows
 * several-fold; a wait that runs out fails the test, so the budget is
 * generous and a met condition still returns at once. Scaled for Windows
 * as the test timeout is: a process starts slowly there, and reading one's
 * command line is a PowerShell process of its own — about 5 s under the
 * full suite. */
export const SETTLE = { timeout: process.platform === "win32" ? 15_000 : 5_000, interval: 10 };

/** The electron suite's budget: what it waits on crosses VS Code's own
 * window — a view mounting, an editor opening, a dialog — which a test
 * host under xvfb answers slower than a subprocess its reply. */
export const WINDOW_SETTLE = 8_000;

/** Polls until `probe` holds, and returns what it found — the shape every
 * wire test needs when the thing it asserts arrives from a subprocess.
 * `undefined` and `false` both mean "not yet": a probe written as a plain
 * comparison waits, never passes on its first look. A wait that runs out
 * names what it waited for, when told. */
export async function waitFor<T>(
  probe: () => T | false | undefined,
  timeoutMs = SETTLE.timeout,
  what?: string | (() => string),
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) return value as T;
    if (Date.now() - start > timeoutMs) {
      const named = typeof what === "function" ? what() : what;
      throw new Error(named === undefined ? "waitFor timed out" : `waitFor timed out: ${named}`);
    }
    await new Promise((r) => setTimeout(r, SETTLE.interval));
  }
}
