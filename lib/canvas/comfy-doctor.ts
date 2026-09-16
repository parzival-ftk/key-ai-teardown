import type { ComfyWorkflow } from "./comfy-bridge";

/**
 * ComfyUI 契约校验器（W32，纯函数）。
 *
 * 背景：`lib\canvas\comfy-bridge.ts` 的 inpaint 节点图是**按文档手写**的，从未对过真实实例
 * （本机无 ComfyUI）。而 ComfyUI 有一个自省接口 `GET /object_info`，它返回**每个节点的真实
 * 输入名、类型与可选值** —— 于是「对着真实例校准参数」可以做成**机械比对**，而不是人肉查文档。
 *
 * 本模块只做纯函数比对（不碰网络）：输入「我的 workflow」+「实例的 object_info」，
 * 输出逐项结论。CLI 见 `scripts\comfy-doctor.mjs`。
 */

export type FindingLevel = "ok" | "warn" | "fail" | "manual";

export interface DoctorFinding {
  level: FindingLevel;
  /** 机器可读的检查项 id（如 `combo:2.channel`） */
  id: string;
  message: string;
  /** 期望（可用值 / 要求） */
  expected?: string;
  /** 实际（我的 workflow 里写的） */
  actual?: string;
  /** 怎么修 */
  hint?: string;
}

/** `/object_info` 的形状（只取我们关心的部分） */
export interface ComfyNodeInfo {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
}
export type ComfyObjectInfo = Record<string, ComfyNodeInfo>;

/* ── 输入规格解读 ── */

type InputSpec = [unknown, Record<string, unknown>?];

function specOf(info: ComfyNodeInfo | undefined, name: string): InputSpec | undefined {
  const required = info?.input?.required;
  const optional = info?.input?.optional;
  const spec = required?.[name] ?? optional?.[name];
  return Array.isArray(spec) ? (spec as InputSpec) : undefined;
}

function inputNames(info: ComfyNodeInfo | undefined): string[] {
  const required = Object.keys(info?.input?.required ?? {});
  const optional = Object.keys(info?.input?.optional ?? {});
  return [...required, ...optional];
}

/**
 * 是否为**固定枚举**（combo）。
 *
 * 坑：ComfyUI 里「可上传文件」的输入（`image` 等）第一元素也是数组，但那列的是
 * **input 目录里现有的文件**，不是允许值 —— 拿它做枚举校验会把正常上传的文件名误判为非法。
 * 判据：选项对象带 `image_upload: true` 的一律排除。
 */
function isFixedEnum(spec: InputSpec | undefined): boolean {
  if (!spec || !Array.isArray(spec[0])) return false;
  const opts = spec[1];
  return opts?.image_upload !== true;
}

function isUploadInput(spec: InputSpec | undefined): boolean {
  return Array.isArray(spec?.[0]) && spec?.[1]?.image_upload === true;
}

function enumOptions(spec: InputSpec | undefined): string[] {
  if (!isFixedEnum(spec)) return [];
  return (spec![0] as unknown[]).map((v) => String(v));
}

/** 连线值：`[nodeId, slotIndex]` */
function isLink(value: unknown): value is [string, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number"
  );
}

/* ── 类型 / 必要输入 检查用的小工具 ── */

/** 节点图的「张量类」输入：必须来自上游连线，不能是常量 */
const TENSOR_TYPES = new Set([
  "IMAGE",
  "MASK",
  "LATENT",
  "MODEL",
  "CLIP",
  "VAE",
  "CONDITIONING",
  "CONTROL_NET",
  "CLIP_VISION",
  "STYLE_MODEL",
  "UPSCALE_MODEL",
  "GLIGEN",
  "SAMPLER",
  "SIGMAS",
  "GUIDER",
  "NOISE",
]);

function requiredSpecs(info: ComfyNodeInfo | undefined): Record<string, InputSpec> {
  const required = info?.input?.required ?? {};
  const out: Record<string, InputSpec> = {};
  for (const [name, spec] of Object.entries(required)) {
    if (Array.isArray(spec)) out[name] = spec as InputSpec;
  }
  return out;
}

/** required 输入是否声明了默认值（有默认 → 后端会补，缺它不算错） */
function hasDefault(spec: InputSpec): boolean {
  const opts = spec[1];
  return !!opts && Object.prototype.hasOwnProperty.call(opts, "default");
}

/**
 * 参数类型检查。返回 `null` 表示「不适用」——combo（交给 enum 检查）、
 * 连线（交给 link 检查）、以及本仓不认识的类型名，都不在这里判。
 */
function checkValueType(
  spec: InputSpec,
  value: unknown,
): { ok: boolean; expected: string } | null {
  const raw = spec[0];
  if (Array.isArray(raw)) return null;
  if (typeof raw !== "string") return null;
  if (isLink(value)) return null;

  switch (raw) {
    case "INT":
      return { ok: typeof value === "number" && Number.isInteger(value), expected: "INT（整数）" };
    case "FLOAT":
      return { ok: typeof value === "number", expected: "FLOAT（数字）" };
    case "STRING":
      return { ok: typeof value === "string", expected: "STRING（字符串）" };
    case "BOOLEAN":
      return { ok: typeof value === "boolean", expected: "BOOLEAN（布尔）" };
    default:
      return TENSOR_TYPES.has(raw)
        ? { ok: false, expected: `${raw}（须连线到上游节点的输出）` }
        : null;
  }
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value);
  return String(value);
}

/* ── 主比对 ── */

/**
 * 逐节点、逐输入比对 workflow 与实例的 object_info。
 * 每一档结论都带 id，便于在报告里定位到具体节点/输入。
 */
/** `inspectComfyNodeGraph` 的可选项 */
export interface InspectOptions {
  /** 图中必须出现的节点类；缺一即 fail（用于「这条流程的必备节点」） */
  requireNodes?: string[];
}

export function inspectComfyNodeGraph(
  workflow: ComfyWorkflow,
  objectInfo: ComfyObjectInfo,
  options: InspectOptions = {},
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const nodeIds = new Set(Object.keys(workflow ?? {}));

  const presentClasses = new Set(Object.values(workflow ?? {}).map((node) => node.class_type));
  for (const requiredClass of options.requireNodes ?? []) {
    if (!presentClasses.has(requiredClass)) {
      findings.push({
        level: "fail",
        id: `missing-class:${requiredClass}`,
        message: `workflow 缺少必要节点类「${requiredClass}」`,
        actual: requiredClass,
        hint: `这条流程必须包含 ${requiredClass}，请检查该节点是否被漏写或被误删`,
      });
    }
  }

  for (const [nodeId, node] of Object.entries(workflow ?? {})) {
    const info = objectInfo?.[node.class_type];

    if (!info) {
      findings.push({
        level: "fail",
        id: `class:${nodeId}`,
        message: `节点类「${node.class_type}」在本实例上不存在`,
        actual: node.class_type,
        hint:
          "要么该节点属于自定义节点包（需在 ComfyUI 里安装），要么类名拼写不同（内置 inpaint 链路只需要 LoadImage / LoadImageMask / CheckpointLoaderSimple / VAEEncodeForInpaint / CLIPTextEncode / KSampler / VAEDecode / SaveImage）",
      });
      continue;
    }

    findings.push({
      level: "ok",
      id: `class:${nodeId}`,
      message: `节点类 ${node.class_type} 存在`,
    });

    const available = inputNames(info);
    let named = 0;

    for (const [inputName, value] of Object.entries(node.inputs ?? {})) {
      const spec = specOf(info, inputName);
      if (!spec) {
        findings.push({
          level: "fail",
          id: `input:${nodeId}.${inputName}`,
          message: `${node.class_type} 没有名为「${inputName}」的输入`,
          expected: available.join(", "),
          actual: inputName,
          hint: "把 workflow 里这个输入名改成实例实际提供的名字",
        });
        continue;
      }
      named += 1;

      if (isLink(value)) {
        if (!nodeIds.has(value[0])) {
          findings.push({
            level: "fail",
            id: `link:${nodeId}.${inputName}`,
            message: `${node.class_type}.${inputName} 连到了不存在的节点`,
            expected: `图内节点：${[...nodeIds].join(", ")}`,
            actual: value[0],
            hint: "检查上游节点 id 是否与 workflow 的键一致",
          });
        }
        continue;
      }

      if (isUploadInput(spec)) {
        findings.push({
          level: "manual",
          id: `manual:${nodeId}.${inputName}`,
          message: `${node.class_type}.${inputName} 需要的是**已上传到 input 目录的文件名**`,
          actual: String(value),
          hint: "本仓先 POST /upload/image 拿到 name，再把这个 name 填进来（不能塞 base64）",
        });
        continue;
      }

      if (isFixedEnum(spec)) {
        const allowed = enumOptions(spec);
        const text = String(value);
        if (allowed.includes(text)) {
          findings.push({
            level: "ok",
            id: `combo:${nodeId}.${inputName}`,
            message: `${node.class_type}.${inputName} = ${text} 在允许值内`,
          });
        } else {
          findings.push({
            level: "fail",
            id: `combo:${nodeId}.${inputName}`,
            message:
              inputName === "ckpt_name"
                ? `${node.class_type}.ckpt_name 指向的**模型**不在本机模型列表里`
                : `${node.class_type}.${inputName} 的值不在本实例的允许列表里`,
            expected: allowed.join(", "),
            actual: text,
            hint:
              inputName === "ckpt_name"
                ? "这是最常见的一处对不上：把本仓的 checkpoint 默认值改成上面列出的本机模型文件名"
                : "把 workflow 里的这个值改成允许列表中的一项",
          });
        }
        continue;
      }

      const typeCheck = checkValueType(spec, value);
      if (typeCheck && !typeCheck.ok) {
        findings.push({
          level: "fail",
          id: `type:${nodeId}.${inputName}`,
          message: `${node.class_type}.${inputName} 的值类型不符：期望 ${typeCheck.expected}`,
          expected: typeCheck.expected,
          actual: describeValue(value),
          hint: "按期望类型改这个值；IMAGE/LATENT 这类输入必须连到上游节点的输出",
        });
      }
    }

    for (const [requiredName, requiredSpec] of Object.entries(requiredSpecs(info))) {
      if (requiredName in (node.inputs ?? {})) continue;
      if (hasDefault(requiredSpec)) {
        findings.push({
          level: "warn",
          id: `required:${nodeId}.${requiredName}`,
          message: `${node.class_type} 未显式给出「${requiredName}」，但该输入有默认值，后端会用默认值`,
          hint: "想把它固定下来就在 workflow 里显式写上",
        });
      } else {
        findings.push({
          level: "fail",
          id: `required:${nodeId}.${requiredName}`,
          message: `${node.class_type} 缺少必要输入「${requiredName}」`,
          expected: requiredName,
          hint: `补上 ${requiredName}（该输入没有默认值，后端会拒绝执行）`,
        });
      }
    }

    findings.push({
      level: "ok",
      id: `inputs:${nodeId}`,
      message: `${node.class_type} 的 ${named} 个输入名全部对得上`,
    });
  }

  return findings;
}

/* ── 实例侧的小工具 ── */

/** 本实例可用的 checkpoint 名（优先问 CheckpointLoaderSimple，缺失则全图扫 ckpt_name） */
export function getAvailableCheckpoints(objectInfo: ComfyObjectInfo): string[] {
  const direct = enumOptions(specOf(objectInfo?.CheckpointLoaderSimple, "ckpt_name"));
  if (direct.length > 0) return direct;

  const found: string[] = [];
  for (const info of Object.values(objectInfo ?? {})) {
    for (const option of enumOptions(specOf(info, "ckpt_name"))) {
      if (!found.includes(option)) found.push(option);
    }
  }
  return found;
}

/** POST /upload/image 的响应形状校验 */
export function inspectUploadResponse(body: unknown): DoctorFinding {
  if (!body || typeof body !== "object") {
    return {
      level: "fail",
      id: "upload:shape",
      message: "上传接口没有返回可解析的 JSON 对象",
      actual: String(body),
      hint: "确认地址是 <base>/upload/image 且以 multipart 提交（字段名 image）",
    };
  }
  const name = (body as { name?: unknown }).name;
  if (typeof name === "string" && name.trim() !== "") {
    return {
      level: "ok",
      id: "upload:shape",
      message: `上传返回文件名：${name}`,
      actual: name,
    };
  }
  return {
    level: "warn",
    id: "upload:shape",
    message: "上传响应里没有 name 字段（本仓会回落到本地文件名）",
    hint: "不同版本/代理可能把名字放在别的字段；若后续 /view 取不到图，先查这里",
  };
}

/* ── 汇总 ── */

export interface FindingSummary {
  ok: number;
  warn: number;
  fail: number;
  manual: number;
  /** 结论：有 fail 即 blocked */
  verdict: "pass" | "attention" | "blocked";
}

export function summarizeFindings(findings: DoctorFinding[]): FindingSummary {
  const summary: FindingSummary = { ok: 0, warn: 0, fail: 0, manual: 0, verdict: "pass" };
  for (const finding of findings ?? []) {
    summary[finding.level] += 1;
  }
  summary.verdict = summary.fail > 0 ? "blocked" : summary.warn > 0 ? "attention" : "pass";
  return summary;
}

const ORDER: Record<FindingLevel, number> = { fail: 0, warn: 1, manual: 2, ok: 3 };

/** 排序：fail → warn → manual → ok（报告应先说坏消息） */
export function rankFindings(findings: DoctorFinding[]): DoctorFinding[] {
  return [...(findings ?? [])].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}

/* ── 面向人的节点级报告（[PASS] / [ERROR]） ── */

const REASON_BY_CATEGORY: Record<string, string> = {
  class: "unknown class_type",
  input: "unknown input name",
  combo: "invalid enum value",
  link: "dangling node reference",
  required: "missing required input",
  type: "type mismatch",
  "missing-class": "missing required node",
  manual: "manual step required",
};

/** 从 finding id 里取出节点 id（`combo:5.scheduler` → `"5"`；图级 id 返回名字本身） */
function nodeIdFromFinding(id: string): string | null {
  const colon = id.indexOf(":");
  if (colon === -1) return null;
  const after = id.slice(colon + 1);
  const dot = after.indexOf(".");
  return dot === -1 ? after : after.slice(0, dot);
}

/** 从 finding id 里取出输入名（`combo:5.scheduler` → `"scheduler"`） */
function inputNameFromFinding(id: string): string | null {
  const colon = id.indexOf(":");
  if (colon === -1) return null;
  const after = id.slice(colon + 1);
  const dot = after.indexOf(".");
  return dot === -1 ? null : after.slice(dot + 1);
}

function reasonOf(id: string): string {
  const category = id.slice(0, id.indexOf(":"));
  return REASON_BY_CATEGORY[category] ?? "validation error";
}

export interface WorkflowReport {
  /** 人类可读的节点级报告全文 */
  text: string;
  findings: DoctorFinding[];
  summary: FindingSummary;
  verdict: FindingSummary["verdict"];
}

/**
 * 生成节点级的 `[PASS]` / `[ERROR]` 报告。
 *
 * 每个节点：无 fail 打印一行 `[PASS] <class_type>`；有 fail 则逐条打印
 * `[ERROR] <class_type>` 并带 `input / value / reason / allowed`。图级问题
 * （如缺少必要节点）单独成段。末行给出 `Workflow validation: PASS|FAIL`。
 */
export function renderWorkflowReport(
  workflow: ComfyWorkflow,
  objectInfo: ComfyObjectInfo,
  options: InspectOptions = {},
): WorkflowReport {
  const findings = inspectComfyNodeGraph(workflow, objectInfo, options);
  const nodeIds = new Set(Object.keys(workflow ?? {}));
  const lines: string[] = [];

  for (const [nodeId, node] of Object.entries(workflow ?? {})) {
    const fails = findings.filter(
      (f) => f.level === "fail" && nodeIdFromFinding(f.id) === nodeId,
    );
    if (fails.length === 0) {
      lines.push(`[PASS] ${node.class_type}`);
      continue;
    }
    for (const finding of fails) {
      lines.push(`[ERROR] ${node.class_type}`);
      lines.push(`  input: ${inputNameFromFinding(finding.id) ?? "-"}`);
      lines.push(`  value: ${finding.actual ?? "-"}`);
      lines.push(`  reason: ${reasonOf(finding.id)}`);
      if (finding.expected) lines.push(`  allowed: ${finding.expected}`);
    }
  }

  const graphFails = findings.filter(
    (f) => f.level === "fail" && !nodeIds.has(nodeIdFromFinding(f.id) ?? ""),
  );
  for (const finding of graphFails) {
    lines.push("[ERROR] (workflow)");
    lines.push(`  value: ${finding.actual ?? "-"}`);
    lines.push(`  reason: ${reasonOf(finding.id)}`);
    lines.push(`  detail: ${finding.message}`);
  }

  const summary = summarizeFindings(findings);
  lines.push("");
  lines.push(`Workflow validation: ${summary.fail > 0 ? "FAIL" : "PASS"}`);

  return { text: lines.join("\n"), findings, summary, verdict: summary.verdict };
}
