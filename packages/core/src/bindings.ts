import type { ReferenceOccurrence, ResearchObject } from './types';

export function resolveReference(reference: ReferenceOccurrence, bindings: ReferenceOccurrence[], objects: ResearchObject[]): ReferenceOccurrence {
  const prior = bindings.find(item => item.blockId === reference.blockId && item.start === reference.start && item.rawText === reference.rawText)
    ?? bindings.find(item => item.id === reference.id && item.rawText === reference.rawText);
  let bound = prior?.objectId ? objects.find(object => object.id === prior.objectId) : undefined;
  const seen = new Set<string>();
  while (bound?.lifecycle === 'merged' && bound.redirectTo && !seen.has(bound.id)) { seen.add(bound.id); bound = objects.find(object => object.id === bound!.redirectTo); }
  const matches = bound ? [bound] : objects.filter(object => object.canonicalName === reference.rawText && object.lifecycle !== 'merged');
  if (matches.length === 1) return { ...reference, objectId: matches[0].id, role: matches[0].role, status: 'bound' };
  return { ...reference, objectId: undefined, role: 'unresolved', status: matches.length ? 'ambiguous' : 'unresolved' };
}
