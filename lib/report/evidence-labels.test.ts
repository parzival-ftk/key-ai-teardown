import { describe, it, expect } from "vitest";
import {
  evidenceLabelText,
  formatEvidenceStats,
} from "./evidence-labels";

describe("证据展示文案（W2/W3 审查修复）", () => {
  it("evidenceLabelText 对已知标签返回中文", () => {
    expect(evidenceLabelText("verified")).toBe("已核实");
    expect(evidenceLabelText("inferred")).toBe("推测");
    expect(evidenceLabelText("missing")).toBe("缺失");
  });

  it("evidenceLabelText 对异常/缺失标签不返回 undefined（防渲染出 [undefined]）", () => {
    expect(evidenceLabelText("bogus")).toBe("未知");
    expect(evidenceLabelText(undefined)).toBe("未知");
    expect(evidenceLabelText(123)).toBe("未知");
    expect(evidenceLabelText(null)).toBe("未知");
  });

  it("formatEvidenceStats 只列非零项并用 · 连接", () => {
    expect(formatEvidenceStats({ verified: 2, inferred: 0, missing: 1 })).toBe(
      "已核实 2 · 缺失 1",
    );
  });

  it("formatEvidenceStats 全零时返回空串（消费方据此不渲染空块）", () => {
    expect(
      formatEvidenceStats({ verified: 0, inferred: 0, missing: 0 }),
    ).toBe("");
  });
});
