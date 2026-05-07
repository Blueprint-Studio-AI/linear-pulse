import { PulseAPI } from "../api";

export async function status(
  workerUrl: string,
  adminToken: string
): Promise<void> {
  const api = new PulseAPI(workerUrl, adminToken);

  try {
    const health = await api.getHealth();
    console.log("Worker:", JSON.stringify(health));
  } catch (e) {
    console.error("Worker unreachable:", (e as Error).message);
  }

  try {
    const topics = await api.getTopics();
    console.log("Topics:", JSON.stringify(topics, null, 2));
  } catch (e) {
    console.error("Topics fetch failed:", (e as Error).message);
  }
}
