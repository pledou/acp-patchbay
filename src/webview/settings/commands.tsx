// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Solutions Unity

// Commands (Trust): the rules that answer for terminal commands an agent
// runs through patchbay — two layers, this workspace's over the machine
// floor. Reviewing what happened lives on Audit; what's stored (and erasing
// it) on Data — one verb per page, one subject per rules page.
import { useState } from "react";
import type { CommandRuleView, SettingsState } from "../../shared/protocol";
import { Icon } from "../shared/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** One command-rules card — instantiated per layer (workspace, machine) so
 * the two lists can't drift in presentation or behavior. */
function CommandRulesCard(props: {
  title: string;
  note: string;
  rules: readonly CommandRuleView[];
  emptyText: string;
  onAdd(rule: CommandRuleView): void;
  onRemove(rule: CommandRuleView): void;
}) {
  const [pattern, setPattern] = useState("");
  const [verdict, setVerdict] = useState<CommandRuleView["verdict"]>("allow");

  return (
    <div className="card">
      <h2 className="mt-0">{props.title}</h2>
      <div className="note mx-0 mt-0 mb-2">
        {props.note}
      </div>
      {props.rules.length === 0 && (
        <div className="note mx-0 mt-0 mb-2">
          {props.emptyText}
        </div>
      )}
      {/* A list grows with every "Always allow" — hundreds of rules is real.
          Bounded at about ten rows and scrolled within, it never pushes the
          card after it, or its own add row, out of reach. */}
      <div className="max-h-[22rem] overflow-y-auto" data-rule-list>
        {props.rules.map((r) => (
          <div className="rule" key={`${r.kind}:${r.pattern}`}>
            <code>{r.pattern}</code>
            <span className={`verdict ${r.verdict}`}>{r.verdict}</span>
            <span
              className="e"
              role="button"
              tabIndex={0}
              aria-label={`Remove rule ${r.pattern}`}
              onClick={() => props.onRemove(r)}
            >
              <Icon name="close" />
            </span>
          </div>
        ))}
      </div>
      <div className="row mt-2.5">
        <Input
          type="text"
          placeholder="command pattern…"
          className="flex-1"
          value={pattern}
          onInput={(e) => setPattern((e.target as HTMLInputElement).value)}
        />
        <Select value={verdict} onValueChange={(v) => setVerdict(v as CommandRuleView["verdict"])}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="allow">allow</SelectItem>
            <SelectItem value="ask">ask</SelectItem>
            <SelectItem value="deny">deny</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={pattern.trim() === ""}
          onClick={() => {
            props.onAdd({ kind: "command", pattern: pattern.trim(), verdict });
            setPattern("");
          }}
        >
          Add rule
        </Button>
      </div>
      <div className="note mx-0 mb-0 mt-2">
        An allow rule trusts the command itself: the agent chooses the directory and environment it
        runs in (cwd, PATH, other variables), and those can change what the command does. The
        approval card shows them; a rule doesn't look at them.
      </div>
    </div>
  );
}

export function CommandsSection(props: {
  state: SettingsState;
  onAddRule(rule: CommandRuleView, layer: "workspace" | "machine"): void;
  onRemoveRule(rule: CommandRuleView, layer: "workspace" | "machine"): void;
}) {
  const { state } = props;

  return (
    <section className="section">
      <h1>Commands</h1>
      <div className="sub">
        Rules for the terminal commands an agent runs through patchbay — each asks before it
        starts, unless a rule answers. Two layers: this workspace&apos;s rules answer first; the
        machine layer is the fallback floor for every workspace; no rule anywhere means ask. An
        agent that runs commands on its own asks through its own permission requests, which carry
        no command line a rule could match: those always ask.
      </div>

      <CommandRulesCard
        title="Command rules — this workspace"
        note="Evaluated first — this repo's own tightening or loosening of the machine floor."
        rules={state.commandRules}
        emptyText="No workspace rules — the machine layer (below) answers, then ask."
        onAdd={(rule) => props.onAddRule(rule, "workspace")}
        onRemove={(rule) => props.onRemoveRule(rule, "workspace")}
      />

      <CommandRulesCard
        title="Command rules — this machine"
        note="The fallback floor for every workspace on this machine — consulted only where the workspace layer stays silent."
        rules={state.machineCommandRules}
        emptyText="No machine rules — every unmatched command asks."
        onAdd={(rule) => props.onAddRule(rule, "machine")}
        onRemove={(rule) => props.onRemoveRule(rule, "machine")}
      />

      <div className="note good">
        Workspace rules live in workspaceState (per user, per workspace), machine rules in global
        storage (per user, this machine) — never in the repo either way. A cloned repository
        cannot arrive pre-authorized.
      </div>
    </section>
  );
}
