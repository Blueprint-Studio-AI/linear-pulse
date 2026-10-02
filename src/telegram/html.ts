// Telegram's HTML parse mode only requires escaping these three characters.
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Truncate raw text before escaping it: cutting escaped text can split an
// entity like "&amp;", which makes Telegram reject the whole message.
// Counts code points so an emoji is never split in half.
export function truncate(text: string, maxLength: number = 200): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return chars.slice(0, maxLength).join("").trimEnd() + "...";
}
