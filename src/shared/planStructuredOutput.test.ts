import { describe, expect, it } from "vitest";
import { parseUniquePlanRoundObject } from "./planStructuredOutput";

function normalize(value: Record<string, unknown>): { title: string } {
  if (typeof value.title !== "string" || !value.title.trim()) {
    throw new Error("规划输出字段 title 必须是非空字符串。");
  }
  if (!Array.isArray(value.milestones)) {
    throw new Error("规划输出字段 milestones 必须是对象数组。");
  }
  return { title: value.title.trim() };
}

const planJson = JSON.stringify({
  title: "构建电商选品 Skill",
  summary: "摘要",
  objective: "目标",
  assumptions: ["假设一", "假设二"],
  milestones: [{ id: "milestone_1", title: "里程碑一" }],
  risks: [{ id: "risk_1", description: "风险" }],
});

describe("parseUniquePlanRoundObject", () => {
  it("parses a single well-formed object", () => {
    expect(parseUniquePlanRoundObject(planJson, normalize)).toEqual({
      title: "构建电商选品 Skill",
    });
  });

  it("salvages a single premature closing brace that split the root object", () => {
    // Production failure 2026-08-02: the model closed the root object right
    // after "assumptions" and continued with ,"milestones":...} — one
    // spurious `}` split one plan JSON into fragments.
    const splitPoint = planJson.indexOf(',"milestones"');
    const broken =
      planJson.slice(0, splitPoint) + "}" + planJson.slice(splitPoint);
    expect(parseUniquePlanRoundObject(broken, normalize)).toEqual({
      title: "构建电商选品 Skill",
    });
  });

  it("survives prose around a salvaged single-slip object", () => {
    const splitPoint = planJson.indexOf(',"milestones"');
    const broken = `以下是计划：\n${
      planJson.slice(0, splitPoint) + "}" + planJson.slice(splitPoint)
    }\n以上。`;
    expect(parseUniquePlanRoundObject(broken, normalize)).toEqual({
      title: "构建电商选品 Skill",
    });
  });

  it("reports the real syntax error instead of a fragment contract error", () => {
    // Two spurious braces cannot be salvaged; the surfaced error must name
    // the syntax problem, not "title 必须是非空字符串" from a fragment.
    const splitPoint = planJson.indexOf(',"milestones"');
    let broken =
      planJson.slice(0, splitPoint) + "}" + planJson.slice(splitPoint);
    const riskPoint = broken.indexOf(',"risks"');
    broken = broken.slice(0, riskPoint) + "}" + broken.slice(riskPoint);
    expect(() => parseUniquePlanRoundObject(broken, normalize)).toThrow(
      /语法错误/,
    );
    expect(() => parseUniquePlanRoundObject(broken, normalize)).not.toThrow(
      /title 必须是非空字符串/,
    );
  });

  it("keeps surfacing contract errors for a single intact object", () => {
    const noTitle = JSON.stringify({
      summary: "只有摘要",
      milestones: [],
    });
    expect(() => parseUniquePlanRoundObject(noTitle, normalize)).toThrow(
      /title 必须是非空字符串/,
    );
  });

  it("still rejects multiple independently valid objects", () => {
    const two = `${planJson}\n${planJson}`;
    expect(() => parseUniquePlanRoundObject(two, normalize)).toThrow(
      /多个符合当前轮次合同/,
    );
  });
});
