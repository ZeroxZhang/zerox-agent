import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("chat IPC handlers", () => {
  const ipcSource = readFileSync(
    path.join(process.cwd(), "src/main/ipc/index.ts"),
    "utf8",
  );

  it("forwards stream events from guided skill input responses to the invoking renderer", () => {
    const respondSkillInputSource = getHandlerSource(
      ipcSource,
      '"chat:respondSkillInput"',
    );

    expect(respondSkillInputSource).toContain("event: IpcMainInvokeEvent");
    expect(respondSkillInputSource).toContain("const sender = event.sender");
    expect(respondSkillInputSource).toContain(
      "container.chatService().respondSkillInput(input,",
    );
    expect(respondSkillInputSource).toContain("onStreamEvent");
    expect(respondSkillInputSource).toContain('sender.send("chat:streamEvent"');
  });
});

function getHandlerSource(source: string, channel: string): string {
  const startIndex = source.indexOf(channel);
  if (startIndex === -1) {
    return "";
  }
  const nextHandlerIndex = source.indexOf("ipcMain.handle(", startIndex + channel.length);
  return source.slice(
    startIndex,
    nextHandlerIndex === -1 ? undefined : nextHandlerIndex,
  );
}
