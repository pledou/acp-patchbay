// The Commands page's view of a layer's rules: the order verdicts win in,
// and how many of each kind there are.
import { describe, expect, it } from "vitest";
import { ruleCounts, sortedRules } from "../src/webview/settings/command-rules-view";
import type { CommandRuleView } from "../src/shared/protocol";

const rules: CommandRuleView[] = [
  { kind: "command", pattern: "npm *", verdict: "allow" },
  { kind: "word", pattern: "sudo", verdict: "deny" },
  { kind: "command", pattern: "git push*", verdict: "ask" },
  { kind: "command", pattern: "rm -rf *", verdict: "deny" },
  { kind: "word", pattern: "--watch", verdict: "ask" },
  { kind: "command", pattern: "git status", verdict: "allow" },
];

describe("sortedRules", () => {
  it("deny, then ask, then allow — by pattern within each; nothing dropped, the list untouched", () => {
    expect(sortedRules(rules).map((r) => `${r.verdict} ${r.pattern}`)).toEqual([
      "deny rm -rf *",
      "deny sudo",
      "ask --watch",
      "ask git push*",
      "allow git status",
      "allow npm *",
    ]);
    expect(rules[0]!.pattern).toBe("npm *");
  });
});

describe("ruleCounts", () => {
  it("counts each kind by verdict, and all of them together", () => {
    expect(ruleCounts(rules)).toEqual({
      byKind: {
        command: { deny: 1, ask: 1, allow: 2, total: 4 },
        word: { deny: 1, ask: 1, allow: 0, total: 2 },
      },
      total: { deny: 2, ask: 2, allow: 2, total: 6 },
    });
    expect(ruleCounts([]).total).toEqual({ deny: 0, ask: 0, allow: 0, total: 0 });
  });
});
