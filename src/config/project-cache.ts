// Cache issue ID → project ID mappings in KV
// Used to resolve project scope for comments (which don't carry project info)

const PREFIX = "ip:";

// Issue events arrive constantly, so only write when the mapping changes
// (KV writes are far scarcer than reads).
export async function cacheIssueProject(
  kv: KVNamespace,
  issueId: string,
  projectId: string
): Promise<void> {
  if ((await lookupIssueProject(kv, issueId)) === projectId) return;
  await kv.put(`${PREFIX}${issueId}`, projectId, {
    expirationTtl: 60 * 60 * 24 * 30, // 30 days
  });
}

export async function lookupIssueProject(
  kv: KVNamespace,
  issueId: string
): Promise<string | null> {
  return kv.get(`${PREFIX}${issueId}`);
}
