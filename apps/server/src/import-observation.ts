import type { NormalizedMessage } from "./opencode";

/**
 * A completed tool step is not the end of an OpenCode agent turn, and model
 * text is never success evidence. The V1 runtime's `/session/status` snapshot
 * lists only *non-idle* sessions, so an absent session is the documented idle
 * state rather than missing data; an explicit `idle` is accepted for flavors
 * that do report it. Everything else keeps the caller in its observing state.
 */
export function importReplyEnded(
  messages: Pick<NormalizedMessage, "parentId" | "completed" | "tools">[],
  messageId: string,
  status: string | undefined,
): boolean {
  const latest = messages
    .filter((message) => message.parentId === messageId)
    .at(-1);
  if (!latest?.completed) return false;
  // A correlated message that still carries tool calls is an intermediate step.
  if (latest.tools?.length) return false;
  return status === "idle" || status === undefined;
}
