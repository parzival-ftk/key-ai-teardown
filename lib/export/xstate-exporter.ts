/**
 * W18 · Mermaid `stateDiagram-v2` → XState v5 转换引擎。
 *
 * 把 PRD 段里的状态图（Mermaid stateDiagram-v2）解析并转换为 **XState v5 `createMachine`
 * 配置**，同时产出 JSON（机器配置）与 TypeScript（可直接落地的源码）两种格式。
 *
 * 设计取舍：
 * - **零依赖、纯函数、同构**：不引入 xstate 运行时（本引擎只产出源码文本），也不依赖 DOM/网络，
 *   因此客户端可即时预览、Node 可单测、server 可复用（见 `/api/export` 的 `format=xstate`）。
 * - **事件名策略**：转换标签（`A --> B : 事件`）即事件名；无标签时合成 `TO_<目标>`，
 *   保证同一状态下多条转换不会互相覆盖。
 * - **安全降级**：空图 / 非状态图 / 语法残缺一律返回**合法的空状态机**并附诊断，
 *   绝不抛错（与项目一贯的「单点失败不阻塞」一致）。
 *
 * XState v5 配置形状依据官方文档：
 * `{ id, initial, states: { A: { on: { EVENT: { target: "B" } }, type: "final" } } }`
 */

export interface XStateTransition {
  target: string;
}

export interface XStateStateNode {
  /** 复合状态的初始子状态 */
  initial?: string;
  /** 终态标记（XState v5：`type: "final"`） */
  type?: "final";
  /** 事件 → 转换 */
  on?: Record<string, XStateTransition>;
  /** 复合状态的子状态 */
  states?: Record<string, XStateStateNode>;
  /** 状态描述（来自 `state "描述" as X` 或 `X : 描述`） */
  meta?: { description?: string };
}

export interface XStateMachineConfig {
  id: string;
  initial?: string;
  states: Record<string, XStateStateNode>;
}

export interface XStateExportResult {
  config: XStateMachineConfig;
  /** 解析过程中的异常提示（空图、无法识别的行、回退等）；正常解析时为空数组 */
  diagnostics: string[];
}

export interface XStateExportOptions {
  /** 机器 id（缺省 `machine`） */
  id?: string;
  /** `createMachine` 源码里的导出名（缺省 `machine`） */
  exportName?: string;
}

/** 解析中间表示：一棵状态树 */
interface ParsedState {
  id: string;
  description?: string;
  initial?: string;
  isFinal: boolean;
  transitions: { event: string; target: string }[];
  children: Map<string, ParsedState>;
}

/** 合法 JS 标识符（非此形状的对象键在生成的 TS 里加引号；CJK 等一律加引号以保证清晰） */
const SAFE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** 匹配一条转换：`A --> B` / `[*] --> A` / `A --> B : 事件` */
const TRANSITION =
  /^\s*(\[\*\]|\S+?)\s*-->\s*(\[\*\]|[^\s:]+)\s*(?::\s*(.*))?$/;

function newState(id: string): ParsedState {
  return { id, isFinal: false, transitions: [], children: new Map() };
}

/** 取容器内状态，不存在则补建（mermaid 中「出现在任意转换里」即视为声明） */
function ensureState(container: ParsedState, id: string): ParsedState {
  let node = container.children.get(id);
  if (!node) {
    node = newState(id);
    container.children.set(id, node);
  }
  return node;
}

/** 目标是否已在上层容器声明（避免向外层转换时在本地造出重复节点） */
function declaredAbove(stack: ParsedState[], id: string): boolean {
  for (const container of stack) {
    if (container.children.has(id)) return true;
  }
  return false;
}

/** 无标签转换的合成事件名 */
function synthesizedEvent(target: string): string {
  return `TO_${target}`;
}

/**
 * 解析 Mermaid stateDiagram-v2 源码 → 状态树。
 * 无法识别的行被忽略并记入诊断，绝不抛错。
 */
function parseStateDiagram(code: string): {
  root: ParsedState;
  diagnostics: string[];
  sawHeader: boolean;
} {
  const root = newState("");
  const stack: ParsedState[] = [root];
  const diagnostics: string[] = [];
  let sawHeader = false;
  let inNote = false;

  const lines = (code ?? "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const lineNo = i + 1;

    if (inNote) {
      if (/^end\s+note$/i.test(line)) inNote = false;
      continue;
    }
    if (line === "" || line.startsWith("%%")) continue;

    if (/^stateDiagram(-v2)?$/i.test(line)) {
      sawHeader = true;
      continue;
    }
    if (/^direction\s+\S+$/i.test(line)) continue;

    // note：单行（含 `:`）直接跳过；多行块读到 `end note`
    if (/^note\b/i.test(line)) {
      if (!line.includes("end note") && !line.includes(":")) inNote = true;
      continue;
    }
    if (/^end\s+note$/i.test(line)) continue;

    if (line === "}") {
      if (stack.length > 1) stack.pop();
      else diagnostics.push(`第 ${lineNo} 行：多余的 "}"，已忽略。`);
      continue;
    }

    // 转换必须在「描述（X : desc）」之前判定 —— 转换行里也含冒号
    const transition = TRANSITION.exec(line);
    if (transition) {
      const from = transition[1];
      const to = transition[2];
      const label = (transition[3] ?? "").trim();
      const container = stack[stack.length - 1];

      if (from === "[*]") {
        container.initial = to;
        ensureState(container, to);
        continue;
      }
      if (to === "[*]") {
        ensureState(container, from).isFinal = true;
        continue;
      }

      const source = ensureState(container, from);
      if (!declaredAbove(stack, to)) ensureState(container, to);

      const event = label || synthesizedEvent(to);
      if (source.transitions.some((t) => t.event === event)) {
        diagnostics.push(
          `第 ${lineNo} 行：状态 "${from}" 已有事件 "${event}"，重复转换已忽略。`,
        );
        continue;
      }
      source.transitions.push({ event, target: to });
      continue;
    }

    // 复合状态：state X {  /  state "描述" as X {
    const compositeAlias = /^state\s+"([^"]*)"\s+as\s+([^\s{]+)\s*\{\s*$/.exec(line);
    if (compositeAlias) {
      const node = ensureState(stack[stack.length - 1], compositeAlias[2]);
      node.description = compositeAlias[1];
      stack.push(node);
      continue;
    }
    const composite = /^state\s+([^\s{]+)\s*\{\s*$/.exec(line);
    if (composite) {
      stack.push(ensureState(stack[stack.length - 1], composite[1]));
      continue;
    }

    // 别名/描述：state "描述" as X
    const alias = /^state\s+"([^"]*)"\s+as\s+([^\s{]+)\s*$/.exec(line);
    if (alias) {
      ensureState(stack[stack.length - 1], alias[2]).description = alias[1];
      continue;
    }

    // 伪状态标注：state X <<fork>> —— 保留状态、忽略构造型
    const stereotype = /^state\s+([^\s{]+)\s*<<[^>]+>>\s*$/.exec(line);
    if (stereotype) {
      ensureState(stack[stack.length - 1], stereotype[1]);
      continue;
    }

    // 显式声明：state X
    const declaration = /^state\s+([^\s{]+)\s*$/.exec(line);
    if (declaration) {
      ensureState(stack[stack.length - 1], declaration[1]);
      continue;
    }

    // 状态描述：X : 描述
    const description = /^([^\s:]+)\s*:\s*(.*)$/.exec(line);
    if (description) {
      ensureState(stack[stack.length - 1], description[1]).description =
        description[2].trim();
      continue;
    }

    diagnostics.push(`第 ${lineNo} 行无法识别，已忽略：${line}`);
  }

  if (stack.length > 1) {
    diagnostics.push("存在未闭合的复合状态（缺少 \"}\"），已按嵌套到文件末尾处理。");
  }
  if (inNote) {
    diagnostics.push("存在未闭合的 note 块，已忽略其余内容。");
  }

  return { root, diagnostics, sawHeader };
}

/** 状态树 → XState 状态字典 */
function toStateNodes(container: ParsedState): Record<string, XStateStateNode> {
  const states: Record<string, XStateStateNode> = {};
  for (const [id, node] of container.children) {
    const out: XStateStateNode = {};
    if (node.children.size > 0) {
      out.states = toStateNodes(node);
      if (node.initial) out.initial = node.initial;
    }
    if (node.isFinal) out.type = "final";
    if (node.transitions.length > 0) {
      const on: Record<string, XStateTransition> = {};
      for (const t of node.transitions) on[t.event] = { target: t.target };
      out.on = on;
    }
    if (node.description) out.meta = { description: node.description };
    states[id] = out;
  }
  return states;
}

/**
 * 主入口：Mermaid stateDiagram-v2 源码 → XState 机器配置 + 诊断。
 * 空图 / 非法输入返回合法空状态机，绝不抛错。
 */
export function mermaidStateToXState(
  code: string,
  options: XStateExportOptions = {},
): XStateExportResult {
  const id = (options.id ?? "").trim() || "machine";
  const { root, diagnostics, sawHeader } = parseStateDiagram(code);

  const states = toStateNodes(root);
  const stateIds = Object.keys(states);

  if (stateIds.length === 0) {
    if (!code.trim()) diagnostics.unshift("输入为空，返回空状态机结构。");
    else if (!sawHeader) diagnostics.unshift("未找到 stateDiagram 声明，且未解析出任何状态。");
    else diagnostics.unshift("状态图内没有状态，返回空状态机结构。");
    return { config: { id, states: {} }, diagnostics };
  }

  let initial = root.initial;
  if (!initial) {
    initial = stateIds[0];
    diagnostics.unshift(
      `未找到初始状态（[*] -->），已回退为第一个状态 "${initial}"。`,
    );
  }

  return { config: { id, initial, states }, diagnostics };
}

/** 机器配置 → JSON 字符串（合法 JSON；诊断不进 JSON，见 xstateConfigToTypeScript） */
export function xstateConfigToJson(config: XStateMachineConfig): string {
  return JSON.stringify(config, null, 2);
}

function printKey(key: string): string {
  return SAFE_IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/** 递归打印 JS 对象字面量（键按需加引号），保证生成的 TS 语法合法 */
function printObject(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${inner}${printObject(v, indent + 1)},`);
    return `[\n${items.join("\n")}\n${pad}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const lines = entries.map(
      ([k, v]) => `${inner}${printKey(k)}: ${printObject(v, indent + 1)},`,
    );
    return `{\n${lines.join("\n")}\n${pad}}`;
  }
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

/**
 * 机器配置 → TypeScript 源码（`createMachine` 可直接落地）。
 * 诊断以行注释附在源码前 —— 这是 JSON 无法承载注释时提示用户降级原因的唯一位置。
 */
export function xstateConfigToTypeScript(
  config: XStateMachineConfig,
  diagnostics: string[] = [],
  options: { exportName?: string } = {},
): string {
  const exportName = (options.exportName ?? "machine").trim() || "machine";
  const lines: string[] = ['import { createMachine } from "xstate";', ""];

  if (diagnostics.length > 0) {
    lines.push("// 诊断：");
    for (const d of diagnostics) lines.push(`// - ${d}`);
    lines.push("");
  }

  lines.push(`export const ${exportName} = createMachine(${printObject(config, 0)});`);
  lines.push("");
  return lines.join("\n");
}

/** 便捷聚合：一次拿到 config / json / ts / diagnostics（UI 层常用） */
export function exportXState(
  code: string,
  options: XStateExportOptions = {},
): XStateExportResult & { json: string; ts: string } {
  const { config, diagnostics } = mermaidStateToXState(code, options);
  return {
    config,
    diagnostics,
    json: xstateConfigToJson(config),
    ts: xstateConfigToTypeScript(config, diagnostics, {
      exportName: options.exportName,
    }),
  };
}
