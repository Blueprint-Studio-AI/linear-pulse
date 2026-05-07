import { botSetup, botInfo, botSetDescription } from "./commands/bot";
import { configGet, configSet, configReset } from "./commands/config";
import { status } from "./commands/status";

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

const WORKER_URL = process.env.PULSE_WORKER_URL ?? "http://localhost:8787";
const ADMIN_TOKEN = process.env.PULSE_ADMIN_TOKEN ?? "";
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

async function main() {
  switch (command) {
    case "bot":
      if (!TELEGRAM_TOKEN) {
        console.error("Set TELEGRAM_BOT_TOKEN env var");
        process.exit(1);
      }
      switch (subcommand) {
        case "setup":
          await botSetup(TELEGRAM_TOKEN);
          break;
        case "info":
          await botInfo(TELEGRAM_TOKEN);
          break;
        case "set-description":
          await botSetDescription(TELEGRAM_TOKEN, args.slice(2).join(" "));
          break;
        default:
          console.log("Usage: linear-pulse bot <setup|info|set-description>");
      }
      break;

    case "config":
      if (!ADMIN_TOKEN) {
        console.error("Set PULSE_ADMIN_TOKEN env var");
        process.exit(1);
      }
      switch (subcommand) {
        case "get":
          await configGet(WORKER_URL, ADMIN_TOKEN);
          break;
        case "set":
          await configSet(WORKER_URL, ADMIN_TOKEN, args.slice(2));
          break;
        case "reset":
          await configReset(WORKER_URL, ADMIN_TOKEN);
          break;
        default:
          console.log("Usage: linear-pulse config <get|set|reset>");
      }
      break;

    case "status":
      await status(WORKER_URL, ADMIN_TOKEN);
      break;

    default:
      console.log("linear-pulse CLI\n");
      console.log("Commands:");
      console.log("  bot setup              Set up Blue's Telegram profile");
      console.log("  bot info               Show bot info");
      console.log("  bot set-description    Set bot description");
      console.log("  config get             View current filter config");
      console.log("  config set             Update filters");
      console.log("  config reset           Reset to defaults");
      console.log("  status                 Worker health + topic mappings");
      console.log("\nEnv vars:");
      console.log("  TELEGRAM_BOT_TOKEN     Telegram bot token");
      console.log(
        "  PULSE_WORKER_URL       Worker URL (default: http://localhost:8787)"
      );
      console.log("  PULSE_ADMIN_TOKEN      Admin bearer token");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
