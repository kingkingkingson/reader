import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { downloadUpdate } from "./update-download";
const update = {
  version: "0.2.0",
  installer: "Reader-0.2.0-mac-arm64.dmg",
  downloadURL: "https://github.com/installer",
  checksumURL: "https://github.com/checksum",
};
it("downloads to a private directory only after SHA256 verification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reader-update-test-"));
  const bytes = new Uint8Array(1024 * 1024 + 1).fill(42);
  const hash = createHash("sha256").update(bytes).digest("hex");
  try {
    const progress: Array<[number, number | undefined]> = [];
    const path = await downloadUpdate(
      update,
      directory,
      async (url) =>
        url === update.checksumURL
          ? new Response(`${hash}  ${update.installer}\n`)
          : new Response(bytes, {
              headers: { "content-length": String(bytes.length) },
            }),
      (received, total) => progress.push([received, total]),
    );
    expect(await readFile(path)).toEqual(Buffer.from(bytes));
    expect(progress[0]).toEqual([0, bytes.length]);
    expect(progress.at(-1)).toEqual([bytes.length, bytes.length]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("removes corrupt or interrupted downloads and never returns a path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reader-update-test-"));
  try {
    const checksums = `${"0".repeat(64)}  ${update.installer}\n`;
    await expect(
      downloadUpdate(update, directory, async (url) =>
        url === update.checksumURL
          ? new Response(checksums)
          : new Response(new Uint8Array(1024 * 1024 + 1)),
      ),
    ).rejects.toThrow("完整性");
    expect(await readdir(directory)).toEqual([]);
    await expect(
      downloadUpdate(update, directory, async (url) => {
        if (url === update.checksumURL) return new Response(checksums);
        throw new Error("connection lost");
      }),
    ).rejects.toThrow("connection lost");
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
