// Cache workflow state ID → name mappings in KV
// Linear's updatedFrom only carries the old stateId, so the "Old → New"
// transition needs the old state's name from an earlier event.

const PREFIX = "st:";

export async function cacheStateName(
  kv: KVNamespace,
  stateId: string,
  name: string
): Promise<void> {
  if ((await lookupStateName(kv, stateId)) === name) return;
  await kv.put(`${PREFIX}${stateId}`, name);
}

export async function lookupStateName(
  kv: KVNamespace,
  stateId: string
): Promise<string | null> {
  return kv.get(`${PREFIX}${stateId}`);
}
