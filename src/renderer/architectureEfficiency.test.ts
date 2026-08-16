/// <reference path="./global.d.ts" />

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_RENDER_INCREMENT,
  getRenderedChatMessageWindow,
  INITIAL_RENDERED_CHAT_MESSAGE_COUNT,
} from "./components/AgentChatPanel";

const appSource = readFileSync(
  path.join(process.cwd(), "src/renderer/App.tsx"),
  "utf8",
);
const chatPanelSource = readFileSync(
  path.join(process.cwd(), "src/renderer/components/AgentChatPanel.tsx"),
  "utf8",
);

describe("renderer architecture efficiency", () => {
  it("renders the latest bounded transcript window and expands it progressively", () => {
    const messages = Array.from({ length: 240 }, (_, index) => index + 1);

    expect(
      getRenderedChatMessageWindow(
        messages,
        INITIAL_RENDERED_CHAT_MESSAGE_COUNT,
      ),
    ).toEqual(messages.slice(-INITIAL_RENDERED_CHAT_MESSAGE_COUNT));
    expect(
      getRenderedChatMessageWindow(
        messages,
        INITIAL_RENDERED_CHAT_MESSAGE_COUNT + CHAT_MESSAGE_RENDER_INCREMENT,
      ),
    ).toEqual(
      messages.slice(
        -(INITIAL_RENDERED_CHAT_MESSAGE_COUNT + CHAT_MESSAGE_RENDER_INCREMENT),
      ),
    );
    expect(chatPanelSource).toContain("getChatSessionTranscriptPage");
    expect(chatPanelSource).not.toContain(
      "await window.buildingAgent.getChatSession(sessionIdToLoad)",
    );
  });

  it("keeps App as the sole startup session-list owner and feeds the sidebar result down", () => {
    const panelBootstrapStart = chatPanelSource.indexOf("Promise.all([");
    const panelBootstrapEnd = chatPanelSource.indexOf(
      "async function loadPersistedSession",
      panelBootstrapStart,
    );
    const panelBootstrap = chatPanelSource.slice(
      panelBootstrapStart,
      panelBootstrapEnd,
    );

    expect(appSource).toContain(
      "window.buildingAgent?.listChatSessions().then",
    );
    expect(appSource).toContain("sidebarSessions={chatSessions}");
    expect(panelBootstrap).not.toContain("listChatSessions()");
  });

  it("isolates the 30-second clock to memoized timestamps and resets the window on session switch", () => {
    expect(chatPanelSource).not.toContain("messageTimeTick");
    expect(chatPanelSource).toContain(
      "const ChatMessageTimestamp = memo(function ChatMessageTimestamp",
    );
    expect(chatPanelSource).toContain("}, 30_000);");
    expect(chatPanelSource).toContain(
      "setRenderedMessageCount(INITIAL_RENDERED_CHAT_MESSAGE_COUNT)",
    );
    expect(chatPanelSource).toContain(
      "pendingEarlierScrollRestoreRef.current = null",
    );
  });
});
