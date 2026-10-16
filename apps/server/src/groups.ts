import { OTHER_GROUP } from "@kipscope/shared";
import { renderTemplate, type Template } from "./names.ts";

/** One entry of `display.groups` (design G3), compiled by `project.ts`. */
export interface GroupRule {
  /** Position in `display.groups`, for messages. */
  index: number;
  /** Absent: the rule applies to every signal. */
  match?: RegExp;
  group: Template;
}

/** Fields of a signal that `group` templates may use besides the named groups. */
export interface GroupFields {
  sender?: string;
}

/**
 * Group of one source name (design G4): the trimmed render of the first rule that matches and
 * renders non-blank; a blank render falls through. undefined → Other (also for a render of Other).
 */
export function assignGroup(
  name: string,
  fields: GroupFields,
  rules: readonly GroupRule[],
): string | undefined {
  for (const rule of rules) {
    const m = rule.match ? rule.match.exec(name) : undefined;
    if (rule.match && !m) continue;
    const group = renderTemplate(rule.group, { sender: fields.sender, ...m?.groups }).trim();
    if (group === "") continue;
    return group === OTHER_GROUP ? undefined : group;
  }
  return undefined;
}
