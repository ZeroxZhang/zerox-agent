# Memory Runtime P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend P0 memory runtime with hybrid/RRF retrieval, lightweight L1 atomic memory extraction, and a local persona markdown profile.

**Architecture:** Keep P1 deterministic and local-first. `MemorySearchOptions.strategy` adds opt-in RRF hybrid ranking; `memoryL1Extractor` extracts high-signal user preference atoms from chat turns; `memoryProfileStore` maintains a human-readable `memory-persona.md` file from newly created atomic memories.

**Tech Stack:** TypeScript, Electron main process, Vitest.

---

## File Structure

- Modify `src/shared/memory.ts`: add `strategy?: "blended" | "hybrid"` and RRF merge helpers.
- Modify `src/shared/memory.test.ts`: prove hybrid search promotes records found by both lexical and vector routes.
- Modify `src/main/memoryStore.ts`: preserve default legacy ranking, allow callers to request hybrid.
- Modify `src/main/agentToolExecutor.ts`: request hybrid strategy from `memory_search`.
- Create `src/main/memoryL1Extractor.ts`: deterministic L1 preference extraction from chat turns.
- Create `src/main/memoryL1Extractor.test.ts`: tests for high-signal extraction and low-signal filtering.
- Create `src/main/memoryProfileStore.ts`: local markdown persona/profile writer.
- Create `src/main/memoryProfileStore.test.ts`: tests persona file creation and idempotent appends.
- Modify `src/main/chatService.ts`: after session memory write, create L1 atoms and update persona profile.
- Modify `src/main/chatService.test.ts`: prove preference-like chat creates semantic L1 memory and updates profile.
- Modify `src/main/main.ts`: instantiate the persona profile store for chat service.

---

### Task 1: Hybrid RRF Memory Search

- [ ] **Step 1: Write failing hybrid retrieval test**

Add a test in `src/shared/memory.test.ts` where one record has lexical matches, one has vector similarity, and one has both. Call `searchMemoryRecords(records, { query, queryEmbedding, strategy: "hybrid" })` and assert the record present in both routes ranks first.

- [ ] **Step 2: Run red test**

Run: `npx vitest run src/shared/memory.test.ts`

Expected: FAIL because `strategy` and RRF merge are not implemented.

- [ ] **Step 3: Implement opt-in hybrid strategy**

Implementation requirements:
- Add `strategy?: "blended" | "hybrid"` to `MemorySearchOptions`.
- Keep existing default behavior as `"blended"` so old scores remain stable.
- For `"hybrid"`, compute lexical rank and vector rank independently.
- Merge candidates with reciprocal-rank fusion using `1 / (60 + rank)`.
- Preserve `kind`, archive filtering, `limit`, and `minScore`.

- [ ] **Step 4: Run green test**

Run: `npx vitest run src/shared/memory.test.ts src/main/memoryStore.test.ts`

Expected: PASS.

---

### Task 2: Lightweight L1 Atomic Memory Extraction

- [ ] **Step 1: Write failing extractor tests**

Create `src/main/memoryL1Extractor.test.ts` with:
- preference-like user text such as `以后默认把报告保存成 Markdown` creates one semantic memory input
- low-signal task text such as `帮我整理下载文件夹` creates no atom
- source is `{ type: "chat_session", sessionId, messageIds }`

- [ ] **Step 2: Run red test**

Run: `npx vitest run src/main/memoryL1Extractor.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement deterministic extractor**

Implementation requirements:
- Export `extractAtomicMemoriesFromChatTurn(input): MemoryInput[]`.
- Detect Chinese/English preference markers: `记住`, `以后`, `默认`, `偏好`, `喜欢`, `希望`, `prefer`, `remember`, `default`.
- Emit `kind: "semantic"`, `tags: ["l1", "chat", "preference"]`, `importance: 4`.
- Title format: `用户偏好：${truncated user text}`.
- Ignore empty/short/low-signal turns.

- [ ] **Step 4: Run green test**

Run: `npx vitest run src/main/memoryL1Extractor.test.ts`

Expected: PASS.

---

### Task 3: Local Persona Markdown Store

- [ ] **Step 1: Write failing profile store tests**

Create `src/main/memoryProfileStore.test.ts` proving:
- `updateFromMemories()` creates `memory-persona.md`
- semantic preference memories become bullets under `## Preferences`
- calling update twice with the same memory does not duplicate bullets

- [ ] **Step 2: Run red test**

Run: `npx vitest run src/main/memoryProfileStore.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement profile store**

Implementation requirements:
- Export `createMemoryProfileStore({ configDir, now })`.
- Store file at `${configDir}/memory-persona.md`.
- File starts with `# Memory Persona`.
- Include `Updated: <ISO timestamp>`.
- Add preference bullets as `- [memoryId] <content>`.
- Preserve existing bullets and avoid duplicates by memory id.

- [ ] **Step 4: Run green test**

Run: `npx vitest run src/main/memoryProfileStore.test.ts`

Expected: PASS.

---

### Task 4: Wire P1 Into Chat Runtime

- [ ] **Step 1: Write failing chat service test**

Add a chat-service test where user says `以后默认把报告保存成 Markdown`, the model replies normally, and expectations verify:
- one session memory is written
- one L1 semantic memory is written
- profile store receives the created L1 memory

- [ ] **Step 2: Run red test**

Run: `npx vitest run src/main/chatService.test.ts`

Expected: FAIL because chat service does not create L1 atoms or update profile.

- [ ] **Step 3: Implement chat wiring**

Implementation requirements:
- Add optional `memoryProfileStore?: { updateFromMemories(memories): Promise<void> }` to chat service.
- After session memory write, call extractor and create atom memories.
- Update persona profile only for successfully created atom memories.
- Do not block final response if atom/profile update fails.
- `memory_search` should pass `strategy: "hybrid"` when searching.
- `main.ts` passes `getMemoryProfileStore()` to chat service.

- [ ] **Step 4: Run affected tests**

Run:
- `npx vitest run src/main/chatService.test.ts src/main/agentToolExecutor.test.ts`
- `npx vitest run src/main/memoryL1Extractor.test.ts src/main/memoryProfileStore.test.ts`

Expected: PASS.

---

### Task 5: Full Verification and Commit

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Commit P1**

Run:
```bash
git add docs/superpowers/plans/2026-06-08-memory-runtime-p1.md src/main src/shared
git commit -m "feat: add memory runtime p1"
```

Expected: commit succeeds; unrelated untracked files remain untouched.
