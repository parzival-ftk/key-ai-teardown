import type { ChatMessage } from "@/lib/llm/provider";
import type { DiagramVisionRequest } from "./vision-parser";

/**
 * 多模态架构图识别 Prompt 与确定性 Stub 兜底（W25）。
 *
 * 两件事：
 *   1. 专门为「截图 → mermaid」调优的 system prompt（节点标签 / 方向 / 边类型）。
 *   2. 无 Key / 本地测试模式下的 deterministic Stub —— 由输入特征（hint + 图片内容哈希）
 *      决定产出，保证「同样的输入给同样的图」，可用于集成与验证。
 *
 * 注：本模块只 `import type` 引用 vision-parser 的类型（编译期擦除），
 * 运行期依赖是单向的（vision-parser → vision-prompt），不成环。
 */

/**
 * 架构图识别 system prompt。
 * 用字符串数组 join 而非模板字面量 —— 正文里必须出现 ``` 围栏，
 * 模板字面量中的反引号会提前结束字符串（本仓库的已知坑）。
 */
export const DIAGRAM_VISION_SYSTEM_PROMPT = [
  "你是架构图识别专家。请从用户提供的架构图 / 流程图截图中提取结构，输出**仅一段** mermaid 代码。",
  "",
  "硬性要求：",
  "1. 只输出一个 ```mermaid 代码块，块外不要任何解释文字。",
  "2. 方向：纵向流程用 `flowchart TD`，横向分层用 `flowchart LR`，状态流转用 `stateDiagram-v2`。",
  "3. 节点标签（Node Label）尽量逐字还原截图中的文字，不翻译、不改写、不臆造截图里没有的节点。",
  "4. 边类型（Edge Type）按截图语义选择：普通调用 `-->`，异步/弱依赖 `-.->`，主链路/强调 `==>`，消息投递或请求转发 `->>`。",
  "5. 节点 id 只能用字母、数字、下划线、连字符，不得含空格或其它特殊符号；中文文字放进方括号里，例如 `UserLogin[用户登录]`。",
  "6. 只画看得清的节点与连线；看不清就留空，不要猜测补全。",
].join("\n");

/** 组装多模态消息（文本 + 图片 data URL） */
export function buildDiagramVisionMessages(
  request: DiagramVisionRequest,
  imageUrl: string,
): ChatMessage[] {
  const hint = (request?.diagramTypeHint ?? "").trim();
  const userText = [
    "请识别这张架构图，输出 mermaid 代码。",
    hint ? `参考：该图可能属于「${hint}」类型。` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: DIAGRAM_VISION_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ];
}

export interface StubDiagram {
  code: string;
  diagramType: string;
}

/** Stub 入口节点用的候选标签（由图片内容哈希决定，保证可复现） */
const ENTRY_LABELS = ["用户", "客户端", "外部系统", "第三方系统"];

const STUB_BUILDERS: Array<{ family: string; build: (entry: string) => string }> = [
  {
    family: "flowchart",
    build: (entry) =>
      [
        "flowchart TD",
        `  U[${entry}] --> GW[API 网关]`,
        "  GW --> AUTH[认证服务]",
        "  GW --> BIZ[业务服务]",
        "  AUTH --> DB[(用户库)]",
        "  BIZ --> DB",
        "  BIZ --> MQ[[消息队列]]",
      ].join("\n"),
  },
  {
    family: "flowchart",
    build: (entry) =>
      [
        "flowchart LR",
        `  U[${entry}] -->|HTTPS| EDGE[边缘节点]`,
        "  EDGE ==> GW[网关]",
        "  GW -.->|异步| Q[(任务队列)]",
        "  GW --> SVC[服务集群]",
      ].join("\n"),
  },
  {
    family: "state",
    build: () =>
      [
        "stateDiagram-v2",
        "  [*] --> 待处理",
        "  待处理 --> 处理中: 领取任务",
        "  处理中 --> 已完成: 成功",
        "  处理中 --> 待处理: 失败重试",
        "  已完成 --> [*]",
      ].join("\n"),
  },
];

/**
 * 稳定哈希：只取首尾各 256 字符 + 总长度参与，避免对 MB 级 base64 全量遍历。
 * 同样的输入必然得到同样的值（deterministic stub 的基础）。
 */
function stableHash(input: string): number {
  const sample =
    input.length > 512
      ? `${input.slice(0, 256)}|${input.slice(-256)}|${input.length}`
      : input;
  let hash = 5381;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash * 33) ^ sample.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickBuilder(hint: string, hash: number) {
  const lower = hint.toLowerCase();
  if (lower.includes("state")) return STUB_BUILDERS[2];
  if (lower.includes("flow") || lower.includes("graph")) {
    return STUB_BUILDERS[hash % 2];
  }
  return STUB_BUILDERS[hash % STUB_BUILDERS.length];
}

/**
 * 由输入特征生成确定性的 Stub 架构图。
 * hint 命中 state / flowchart 时按其类型产出；否则由图片内容哈希挑选模板。
 */
export function buildStubDiagram(request: DiagramVisionRequest): StubDiagram {
  const hint = (request?.diagramTypeHint ?? "").trim();
  const hash = stableHash(`${request?.mimeType ?? ""}|${request?.imageBase64 ?? ""}`);
  const builder = pickBuilder(hint, hash);
  const entry = ENTRY_LABELS[hash % ENTRY_LABELS.length];
  const code = builder.build(entry);
  return {
    code,
    diagramType: builder.family === "state" ? "stateDiagram-v2" : "flowchart",
  };
}
