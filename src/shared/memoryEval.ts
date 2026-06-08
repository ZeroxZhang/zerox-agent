import {
  searchMemoryRecords,
  type MemoryRecord,
  type MemorySearchResult,
} from "./memory";

export type MemoryEvalCase = {
  id: string;
  query: string;
  expectedMemoryIds: string[];
  rejectedMemoryIds?: string[];
  topK?: number;
};

export type MemoryEvalCaseResult = {
  id: string;
  query: string;
  passed: boolean;
  retrievedMemoryIds: string[];
  expectedMemoryIds: string[];
  rejectedMemoryIds: string[];
  reason?: string;
};

export type MemoryEvalReport = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  failures: Array<{ caseId: string; reason: string }>;
  cases: MemoryEvalCaseResult[];
};

export type RunMemoryEvalResult =
  | { ok: true; report: MemoryEvalReport }
  | { ok: false; message: string };

export function runMemoryEvals(
  records: MemoryRecord[],
  cases: MemoryEvalCase[],
): MemoryEvalReport {
  const caseResults = cases.map((testCase) =>
    runMemoryEvalCase(records, testCase),
  );
  const failures = caseResults
    .filter((result): result is MemoryEvalCaseResult & { reason: string } =>
      Boolean(!result.passed && result.reason),
    )
    .map((result) => ({
      caseId: result.id,
      reason: result.reason,
    }));
  const passed = caseResults.filter((result) => result.passed).length;

  return {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    passRate: ratio(passed, cases.length),
    failures,
    cases: caseResults,
  };
}

export function createDefaultMemoryEvalCases(
  records: MemoryRecord[],
): MemoryEvalCase[] {
  return records
    .filter((record) => !record.archivedAt && record.importance >= 3)
    .sort(
      (left, right) =>
        right.importance - left.importance ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, 5)
    .map((record) => ({
      id: `default-${record.id}`,
      query: record.title,
      expectedMemoryIds: [record.id],
      topK: 5,
    }));
}

export function createMemoryEvalFixtures(): [MemoryRecord[], MemoryEvalCase[]] {
  const records = [
    createFixtureMemory({
      id: "fixture_markdown_preference",
      title: "Markdown report preference",
      content: "User prefers Markdown reports by default.",
      tags: ["preference", "report"],
      importance: 5,
    }),
    createFixtureMemory({
      id: "fixture_downloads_workflow",
      title: "Downloads workflow",
      content: "Inspect the downloads directory before organizing files.",
      tags: ["downloads", "procedure"],
      importance: 4,
    }),
  ];

  return [
    records,
    [
      {
        id: "fixture-markdown-preference",
        query: "Markdown report preference",
        expectedMemoryIds: ["fixture_markdown_preference"],
        topK: 3,
      },
      {
        id: "fixture-downloads-workflow",
        query: "downloads workflow",
        expectedMemoryIds: ["fixture_downloads_workflow"],
        topK: 3,
      },
    ],
  ];
}

function runMemoryEvalCase(
  records: MemoryRecord[],
  testCase: MemoryEvalCase,
): MemoryEvalCaseResult {
  const topK = testCase.topK ?? 5;
  const results: MemorySearchResult[] = searchMemoryRecords(records, {
    query: testCase.query,
    kind: "all",
    limit: topK,
  });
  const retrievedMemoryIds = results.map((result) => result.record.id);
  const rejectedMemoryIds = testCase.rejectedMemoryIds ?? [];
  const rejectedHit = rejectedMemoryIds.find((id) =>
    retrievedMemoryIds.includes(id),
  );
  const missingExpected = testCase.expectedMemoryIds.find(
    (id) => !retrievedMemoryIds.includes(id),
  );

  if (rejectedHit) {
    return {
      id: testCase.id,
      query: testCase.query,
      passed: false,
      retrievedMemoryIds,
      expectedMemoryIds: testCase.expectedMemoryIds,
      rejectedMemoryIds,
      reason: `Rejected memory "${rejectedHit}" was retrieved.`,
    };
  }

  if (missingExpected) {
    return {
      id: testCase.id,
      query: testCase.query,
      passed: false,
      retrievedMemoryIds,
      expectedMemoryIds: testCase.expectedMemoryIds,
      rejectedMemoryIds,
      reason: `Expected memory "${missingExpected}" was not retrieved.`,
    };
  }

  return {
    id: testCase.id,
    query: testCase.query,
    passed: true,
    retrievedMemoryIds,
    expectedMemoryIds: testCase.expectedMemoryIds,
    rejectedMemoryIds,
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 1;
  }

  return Number((numerator / denominator).toFixed(4));
}

function createFixtureMemory(
  partial: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "title" | "content">,
): MemoryRecord {
  return {
    kind: "semantic",
    tags: [],
    source: { type: "system" },
    importance: 3,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    ...partial,
  };
}
