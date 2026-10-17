// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Solutions Unity

// How a command rule reads wherever one is named — a card saying which
// rule decided, the Commands page's tester.
import type { CommandRuleView, RuleMatchView } from "./protocol";

/** `npm run *` for a command rule, `word sudo` for a word. */
export function ruleLabel(rule: Pick<CommandRuleView, "kind" | "pattern">): string {
  return rule.kind === "word" ? `word ${rule.pattern}` : rule.pattern;
}

/** A rule with its layer: `word sudo (machine)`. */
export function matchLabel(match: RuleMatchView): string {
  return `${ruleLabel(match.rule)} (${match.layer})`;
}
