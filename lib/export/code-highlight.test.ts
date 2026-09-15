import { describe, it, expect } from "vitest";
import { highlightJson, highlightTypeScript, tokenize } from "./code-highlight";
import { exportXState } from "./xstate-exporter";

/**
 * W18 · 零依赖语法高亮单测。
 *
 * 最强的一条断言是**往返不变量**：token 拼接必须逐字还原输入 ——
 * 任何吞字 / 丢字 / 重复的扫描器回归都会在这里被抓住，比逐个 token 断言更耐改。
 */

const DIAGRAM = `stateDiagram-v2
  [*] --> Idle
  Idle --> Loading : SUBMIT
  Loading --> Success : DONE
  Success --> [*]`;

const roundtrip = (code: string, lang: "json" | "ts") =>
  tokenize(code, lang)
    .map((t) => t.value)
    .join("");

describe("往返不变量（不得吞字 / 重复）", () => {
  it("JSON：真实导出结果逐字还原", () => {
    const { json } = exportXState(DIAGRAM);
    expect(roundtrip(json, "json")).toBe(json);
  });

  it("TypeScript：真实导出源码逐字还原（含 import / 注释）", () => {
    const { ts } = exportXState(DIAGRAM);
    expect(roundtrip(ts, "ts")).toBe(ts);
  });

  it("边界：未闭合字符串、块注释、CJK、转义引号均还原", () => {
    const tricky = 'const a = "未闭合\n/* 注释 */ b: "x\\"y" 中文 1.5e3';
    expect(roundtrip(tricky, "ts")).toBe(tricky);
    const trickyJson = '{"中文键": "值", "n": -1.5e3}';
    expect(roundtrip(trickyJson, "json")).toBe(trickyJson);
  });
});

describe("JSON 高亮", () => {
  it("键为 property、字符串值为 string、数字为 number、字面量为 boolean", () => {
    const tokens = highlightJson('{"a": "x", "b": 12, "c": true, "d": null}');
    const byValue = (v: string) => tokens.find((t) => t.value === v)?.type;
    expect(byValue('"a"')).toBe("property");
    expect(byValue('"x"')).toBe("string");
    expect(byValue("12")).toBe("number");
    expect(byValue("true")).toBe("boolean");
    expect(byValue("null")).toBe("boolean");
  });

  it("标点为 punctuation", () => {
    const tokens = highlightJson("{}");
    expect(tokens.map((t) => t.type)).toEqual(["punctuation", "punctuation"]);
  });
});

describe("TypeScript 高亮", () => {
  it("关键字与导入字符串", () => {
    const code = 'import { createMachine } from "xstate";';
    const tokens = highlightTypeScript(code);
    const byValue = (v: string) => tokens.find((t) => t.value === v)?.type;
    expect(byValue("import")).toBe("keyword");
    expect(byValue("from")).toBe("keyword");
    expect(byValue('"xstate"')).toBe("string");
    // 非关键字的标识符保持 plain
    expect(byValue("createMachine")).toBe("plain");
  });

  it("行注释与块注释", () => {
    const tokens = highlightTypeScript("// 诊断：\nconst a = 1; /* 块 */");
    const comments = tokens.filter((t) => t.type === "comment").map((t) => t.value);
    expect(comments).toContain("// 诊断：");
    expect(comments).toContain("/* 块 */");
  });

  it("数字与标点", () => {
    const tokens = highlightTypeScript("const x = 42;");
    expect(tokens.some((t) => t.type === "number" && t.value === "42")).toBe(true);
    expect(tokens.some((t) => t.type === "punctuation" && t.value === "=")).toBe(true);
  });
});
