import { TelegramAPI } from "../api";

export async function botSetup(token: string): Promise<void> {
  const tg = new TelegramAPI(token);

  console.log("Setting up Blue...\n");

  const desc = await tg.setDescription(
    "Linear notifications for Blueprint Studio"
  );
  console.log("Description:", JSON.stringify(desc));

  const about = await tg.setShortDescription(
    "Team activity feed from Linear"
  );
  console.log("About:", JSON.stringify(about));

  console.log("\nBlue is configured.");
}

export async function botInfo(token: string): Promise<void> {
  const tg = new TelegramAPI(token);
  const info = await tg.getMe();
  console.log(JSON.stringify(info, null, 2));
}

export async function botSetDescription(
  token: string,
  description: string
): Promise<void> {
  const tg = new TelegramAPI(token);
  const result = await tg.setDescription(description);
  console.log(JSON.stringify(result, null, 2));
}
