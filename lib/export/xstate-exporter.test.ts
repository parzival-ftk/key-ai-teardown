import { describe, it, expect } from "vitest";
import {
  mermaidStateToXState,
  xstateConfigToJson,
  xstateConfigToTypeScript,
  exportXState,
  type XStateStateNode,
} from "./xstate-exporter";

/**
 * W18 · Mermaid stateDiagram-v2 → XState v5 转换引擎单测。
 *
 * 断言聚焦「解析与提取」「双格式输出」「安全降级」三类出口（需求 1 的三条要求）。
 * XState v5 配置形状取自官方文档：`{ id, initial, states: { A: { on: { E: { target: "B" } }, type: "final" } } }`。
 */

const TRAFFIC = `stateDiagram-v2
  [*] --> Idle
  Idle --> Loading : SUBMIT
  Loading --> Success : DONE
  Loading --> Error : FAIL
  Success --> [*]
  Error --> [*]`;

function statesOf(code: string): Record<string, XStateStateNode> {
  return mermaidStateToXState(code).config.states;
}

describe("mermaidStateToXState（解析与提取）", () => {
  it("提取 initial 与状态字典", () => {
    const { config } = mermaidStateToXState(TRAFFIC);
    expect(config.initial).toBe("Idle");
    expect(Object.keys(config.states)).toEqual([
      "Idle",
      "Loading",
      "Success",
      "Error",
    ]);
  });

  it("转换事件为 on: { EVENT: { target } }", () => {
    const { config } = mermaidStateToXState(TRAFFIC);
    expect(config.states.Idle.on).toEqual({ SUBMIT: { target: "Loading" } });
    expect(config.states.Loading.on).toEqual({
      DONE: { target: "Success" },
      FAIL: { target: "Error" },
    });
  });

  it("`--> [*]` 的状态标记为 type: final", () => {
    const { config } = mermaidStateToXState(TRAFFIC);
    expect(config.states.Success.type).toBe("final");
    expect(config.states.Error.type).toBe("final");
    expect(config.states.Idle.type).toBeUndefined();
  });

  it("可指定机器 id（缺省 machine）", () => {
    expect(mermaidStateToXState(TRAFFIC).config.id).toBe("machine");
    expect(mermaidStateToXState(TRAFFIC, { id: "orderFlow" }).config.id).toBe(
      "orderFlow",
    );
  });

  it("无标签转换合成事件名 TO_<目标>（大写）", () => {
    const states = statesOf(`stateDiagram-v2
  [*] --> A
  A --> B
  B --> C`);
    expect(states.A.on).toEqual({ TO_B: { target: "B" } });
    expect(states.B.on).toEqual({ TO_C: { target: "C" } });
  });

  it("解析复合（嵌套）状态，内层 [*] 作为其 initial", () => {
    const states = statesOf(`stateDiagram-v2
  [*] --> Outer
  state Outer {
    [*] --> InnerA
    InnerA --> InnerB : GO
  }`);
    expect(states.Outer.initial).toBe("InnerA");
    expect(Object.keys(states.Outer.states ?? {}).sort()).toEqual([
      "InnerA",
      "InnerB",
    ]);
    expect(states.Outer.states?.InnerA.on).toEqual({ GO: { target: "InnerB" } });
  });

  it("容错：前置注释、空行、缺 stateDiagram 头、note 块", () => {
    const { config, diagnostics } = mermaidStateToXState(`%% 这是注释
stateDiagram-v2
  [*] --> A

  note right of A : 一段说明
  note left of A
    多行说明
  end note
  A --> B`);
    expect(config.initial).toBe("A");
    expect(config.states.A.on).toEqual({ TO_B: { target: "B" } });
    expect(config.states.B).toBeDefined();
    expect(diagnostics.join()).not.toContain("note");
  });

  it("state \"描述\" as X 与 `X : 描述` 归入 meta.description", () => {
    const states = statesOf(`stateDiagram-v2
  [*] --> A
  state "长名字" as A
  B : 说明文字
  A --> B`);
    expect(states.A.meta?.description).toBe("长名字");
    expect(states.B.meta?.description).toBe("说明文字");
  });

  it("被引用但未声明的状态自动补建（不产生悬空 target）", () => {
    const { config } = mermaidStateToXState(`stateDiagram-v2
  [*] --> A
  A --> 未声明的B`);
    expect(config.states["未声明的B"]).toBeDefined();
    expect(config.states.A.on).toEqual({ TO_未声明的B: { target: "未声明的B" } });
  });

  it("同一输入两次调用结果完全一致（确定性）", () => {
    const a = mermaidStateToXState(TRAFFIC);
    const b = mermaidStateToXState(TRAFFIC);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("mermaidStateToXState（安全降级）", () => {
  it("空输入 → 合法空状态机 + 诊断，不抛错", () => {
    const { config, diagnostics } = mermaidStateToXState("");
    expect(config.id).toBe("machine");
    expect(config.states).toEqual({});
    expect(config.initial).toBeUndefined();
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("只有表头无转换 → 空状态机 + 诊断", () => {
    const { config, diagnostics } = mermaidStateToXState("stateDiagram-v2");
    expect(config.states).toEqual({});
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("非状态图 / 垃圾输入 → 不抛错，空状态机 + 诊断", () => {
    const junk = "这不是状态图 @@ !! \n ### ???";
    expect(() => mermaidStateToXState(junk)).not.toThrow();
    const { config, diagnostics } = mermaidStateToXState(junk);
    expect(config.states).toEqual({});
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("未闭合的复合状态括号不崩溃", () => {
    expect(() =>
      mermaidStateToXState(`stateDiagram-v2
  [*] --> A
  state Outer {
    A --> B`),
    ).not.toThrow();
  });

  it("缺失初始状态时回退为第一个状态并记录诊断", () => {
    const { config, diagnostics } = mermaidStateToXState(`stateDiagram-v2
  A --> B : GO
  B --> A : BACK`);
    expect(config.initial).toBe("A");
    expect(diagnostics.join()).toContain("初始状态");
  });
});

describe("xstateConfigToJson", () => {
  it("输出可 JSON.parse 的合法字符串且与 config 保真", () => {
    const { config } = mermaidStateToXState(TRAFFIC);
    const json = xstateConfigToJson(config);
    expect(JSON.parse(json)).toEqual(config);
  });

  it("空状态机也能输出合法 JSON", () => {
    const { config } = mermaidStateToXState("");
    const json = xstateConfigToJson(config);
    expect(JSON.parse(json).states).toEqual({});
  });
});

describe("xstateConfigToTypeScript", () => {
  it("产出可用的 createMachine 源码（import / id / initial / on / target / final）", () => {
    const { config, diagnostics } = mermaidStateToXState(TRAFFIC, { id: "light" });
    const ts = xstateConfigToTypeScript(config, diagnostics);
    expect(ts).toContain('import { createMachine } from "xstate"');
    expect(ts).toContain("createMachine({");
    expect(ts).toContain('id: "light"');
    expect(ts).toContain('initial: "Idle"');
    expect(ts).toContain("SUBMIT");
    expect(ts).toContain('target: "Loading"');
    expect(ts).toContain('type: "final"');
    expect(ts).toContain("export const machine");
  });

  it("诊断以注释形式附加在源码中", () => {
    const { config, diagnostics } = mermaidStateToXState("");
    const ts = xstateConfigToTypeScript(config, diagnostics);
    expect(ts).toContain("// 诊断");
    expect(ts.split("\n").every((l) => !l.includes("\n"))).toBe(true);
    expect(ts).toContain("// - ");
  });

  it("非合法标识符的事件名 / 状态名加引号（生成合法 TS）", () => {
    const ts = xstateConfigToTypeScript(
      mermaidStateToXState(`stateDiagram-v2
  [*] --> S1
  S1 --> S2 : 提交订单`).config,
      [],
    );
    expect(ts).toContain('"提交订单"');
  });

  it("无诊断时不产生空的诊断注释块", () => {
    const ts = xstateConfigToTypeScript({ id: "m", initial: "a", states: { a: {} } }, []);
    expect(ts).not.toContain("// 诊断");
  });
});

describe("exportXState（便捷聚合）", () => {
  it("一次返回 config / json / ts / diagnostics，四者自洽", () => {
    const result = exportXState(TRAFFIC, { id: "light" });
    expect(result.config.id).toBe("light");
    expect(JSON.parse(result.json)).toEqual(result.config);
    expect(result.ts).toContain('id: "light"');
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});
