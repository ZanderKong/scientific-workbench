/**
 * Read-only access to the build-time agent knowledge bundle. The server never
 * reads repository docs at runtime and never resolves caller-provided paths.
 */
import {
  KnowledgeNotFoundError,
  knowledgeIndex,
  loadKnowledgeBundle,
  readKnowledge,
  type AgentKnowledgeEntry,
} from "@workbench/core";
import { agentKnowledge } from "./generated/agent-knowledge";

export { KnowledgeNotFoundError };
export type { AgentKnowledgeEntry };

export const knowledgeVersion = agentKnowledge.version;
export const knowledgeBundleHash = agentKnowledge.bundleHash;

export function listKnowledge(): Omit<AgentKnowledgeEntry, "content">[] {
  return knowledgeIndex(agentKnowledge);
}

export function getKnowledge(id: string): AgentKnowledgeEntry {
  return readKnowledge(agentKnowledge, id);
}

export function knowledgeDependencies(id: string): AgentKnowledgeEntry[] {
  return loadKnowledgeBundle(agentKnowledge, id);
}
