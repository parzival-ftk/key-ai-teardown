import { describe, it, expect } from "vitest";
import {
  htmlToFigmaDocument,
  figmaDocumentToJson,
  hexToFigmaColor,
  resolveTailwindColor,
  parseTailwindStyle,
  type FigmaDocument,
  type FigmaNode,
} from "./figma-exporter";

/**
 * W17 · HTML/Tailwind → Figma JSON 转换引擎单测。
 *
 * 断言聚焦「结构映射」「样式映射」「异常防护」三类出口（需求 1 的三条要求），
 * 不锁死 id 生成等无关实现细节。
 */

/** 安全取子节点（容器才有 children；TEXT 叶子无） */
const kids = (node: FigmaNode): FigmaNode[] => node.children ?? [];

/** 取文档画布下的第一个节点（多数用例的根） */
const firstNode = (doc: FigmaDocument): FigmaNode => kids(doc.children[0])[0];

/** 直接由 HTML 取画布的直接子节点列表 */
const canvasChildrenOf = (html: string): FigmaNode[] =>
  kids(htmlToFigmaDocument(html).children[0]);

/** 深度优先按 name 查找（便于断言深层结构） */
function findByName(node: FigmaNode, name: string): FigmaNode | undefined {
  if (node.name === name) return node;
  for (const c of kids(node)) {
    const hit = findByName(c, name);
    if (hit) return hit;
  }
  return undefined;
}

/** 收集整棵树的节点类型序列 */
function collectTypes(node: FigmaNode, acc: string[] = []): string[] {
  acc.push(node.type);
  for (const c of kids(node)) collectTypes(c, acc);
  return acc;
}

describe("hexToFigmaColor（纯函数）", () => {
  it("6 位 hex → 0–1 的 RGBA", () => {
    expect(hexToFigmaColor("#ffffff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("分通道换算正确（blue-500）", () => {
    const c = hexToFigmaColor("#2b7fff")!;
    expect(c.r).toBeCloseTo(0x2b / 255, 5);
    expect(c.g).toBeCloseTo(0x7f / 255, 5);
    expect(c.b).toBeCloseTo(1, 5);
    expect(c.a).toBe(1);
  });

  it("非法输入返回 null（不抛错）", () => {
    expect(hexToFigmaColor("not-a-color")).toBeNull();
    expect(hexToFigmaColor("#xyz")).toBeNull();
    expect(hexToFigmaColor("")).toBeNull();
  });
});

describe("resolveTailwindColor（色系 → hex）", () => {
  it("色系 + 色阶命中调色板", () => {
    expect(resolveTailwindColor("blue-500")).toBe("#2b7fff");
    expect(resolveTailwindColor("slate-50")).toBe("#f8fafc");
  });

  it("语义色 white / black", () => {
    expect(resolveTailwindColor("white")).toBe("#ffffff");
    expect(resolveTailwindColor("black")).toBe("#000000");
  });

  it("未知色系或色阶返回 null", () => {
    expect(resolveTailwindColor("brand-500")).toBeNull();
    expect(resolveTailwindColor("blue-123")).toBeNull();
  });
});

describe("parseTailwindStyle（类名 → 样式属性）", () => {
  it("bg-* → 背景填充；text-<色> → 文本色", () => {
    const s = parseTailwindStyle("bg-blue-500 text-white");
    expect(s.background?.color.b).toBeCloseTo(1, 5);
    expect(s.textColor).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("p-4 / px-2 / py-3 → 四向 padding（px 覆盖左右）", () => {
    expect(parseTailwindStyle("p-4").padding).toEqual({
      top: 16,
      right: 16,
      bottom: 16,
      left: 16,
    });
    expect(parseTailwindStyle("px-2 py-3").padding).toEqual({
      top: 12,
      right: 8,
      bottom: 12,
      left: 8,
    });
    expect(parseTailwindStyle("pt-1 pr-2 pb-3 pl-4").padding).toEqual({
      top: 4,
      right: 8,
      bottom: 12,
      left: 16,
    });
  });

  it("rounded-lg → cornerRadius 8；裸 rounded → 4；rounded-full → 9999", () => {
    expect(parseTailwindStyle("rounded-lg").cornerRadius).toBe(8);
    expect(parseTailwindStyle("rounded").cornerRadius).toBe(4);
    expect(parseTailwindStyle("rounded-full").cornerRadius).toBe(9999);
  });

  it("text-xl / font-bold → fontSize / fontWeight", () => {
    const s = parseTailwindStyle("text-xl font-bold");
    expect(s.fontSize).toBe(20);
    expect(s.fontWeight).toBe(700);
  });

  it("gap-2 → itemSpacing；flex-col → 纵向布局；opacity-50 → 0.5", () => {
    const s = parseTailwindStyle("gap-2 flex-col opacity-50");
    expect(s.itemSpacing).toBe(8);
    expect(s.layoutMode).toBe("VERTICAL");
    expect(s.opacity).toBeCloseTo(0.5, 5);
  });

  it("text-<字号> 与 text-<颜色> 不混淆（分别落到 fontSize / textColor）", () => {
    const s = parseTailwindStyle("text-2xl text-blue-500");
    expect(s.fontSize).toBe(24);
    expect(s.textColor?.b).toBeCloseTo(1, 5);
  });

  it("带变体前缀的类被忽略（无静态求值）", () => {
    expect(() =>
      parseTailwindStyle("hover:bg-red-500 group flex-1 foo-bar"),
    ).not.toThrow();
    expect(parseTailwindStyle("hover:bg-red-500 foo-bar").background).toBeUndefined();
  });
});

describe("htmlToFigmaDocument（结构映射）", () => {
  it("顶层为 DOCUMENT > CANVAS，画布挂载解析出的节点", () => {
    const doc = htmlToFigmaDocument("<div></div>");
    expect(doc.type).toBe("DOCUMENT");
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe("CANVAS");
    expect(kids(doc.children[0]).length).toBeGreaterThan(0);
  });

  it("div/section → FRAME；p/h1/span → TEXT；button → COMPONENT；input → FRAME", () => {
    const doc = htmlToFigmaDocument(
      "<section><h1>标题</h1><p>正文</p><button>按钮</button><input /></section>",
    );
    const section = firstNode(doc);
    expect(section.type).toBe("FRAME");
    const types = collectTypes(section);
    expect(types).toContain("TEXT"); // h1 / p
    expect(types).toContain("COMPONENT"); // button
    expect(kids(section).some((c) => c.type === "FRAME")).toBe(true); // input
  });

  it("文本节点被提取为 TEXT 且 characters 正确", () => {
    const doc = htmlToFigmaDocument("<div><p>你好，世界</p></div>");
    const text = findByName(doc.children[0], "p");
    expect(text?.type).toBe("TEXT");
    expect(text?.characters).toBe("你好，世界");
  });

  it("容器内的裸文本也会生成 TEXT 子节点", () => {
    const doc = htmlToFigmaDocument("<div>裸文本</div>");
    const frame = firstNode(doc);
    expect(frame.type).toBe("FRAME");
    expect(
      kids(frame).some((c) => c.type === "TEXT" && c.characters === "裸文本"),
    ).toBe(true);
  });

  it("嵌套结构递归映射", () => {
    const doc = htmlToFigmaDocument(
      "<div><section><div><button>深</button></div></section></div>",
    );
    const outer = firstNode(doc);
    const section = kids(outer)[0];
    const inner = kids(section)[0];
    const button = kids(inner)[0];
    expect(outer.type).toBe("FRAME");
    expect(section.type).toBe("FRAME");
    expect(inner.type).toBe("FRAME");
    expect(button.type).toBe("COMPONENT");
  });
});

describe("htmlToFigmaDocument（样式映射）", () => {
  it("FRAME 的 bg-*/p-*/rounded-* 落到 fills/padding/cornerRadius", () => {
    const doc = htmlToFigmaDocument('<div class="bg-blue-500 p-4 rounded-lg"></div>');
    const frame = firstNode(doc);
    expect(frame.type).toBe("FRAME");
    expect(frame.fills?.[0].type).toBe("SOLID");
    expect(frame.fills?.[0].color.b).toBeCloseTo(1, 5);
    expect(frame.paddingTop).toBe(16);
    expect(frame.paddingRight).toBe(16);
    expect(frame.paddingBottom).toBe(16);
    expect(frame.paddingLeft).toBe(16);
    expect(frame.cornerRadius).toBe(8);
  });

  it("TEXT 的 text-* 落到 fills，font-* 落到 fontWeight", () => {
    const doc = htmlToFigmaDocument('<p class="text-white text-xl font-bold">Hi</p>');
    const text = findByName(doc.children[0], "p");
    expect(text?.fills?.[0].color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(text?.fontSize).toBe(20);
    expect(text?.fontWeight).toBe(700);
  });

  it("opacity-50 → 节点 opacity 0.5", () => {
    const doc = htmlToFigmaDocument('<div class="bg-black opacity-50"></div>');
    expect(firstNode(doc).opacity).toBeCloseTo(0.5, 5);
  });
});

describe("htmlToFigmaDocument（异常防护 / fallback）", () => {
  it("空输入不抛错，返回带空画布的文档", () => {
    const doc = htmlToFigmaDocument("");
    expect(doc.type).toBe("DOCUMENT");
    expect(doc.children[0].type).toBe("CANVAS");
    expect(kids(doc.children[0])).toEqual([]);
  });

  it("缺失样式时给出安全初始值（无 fills、padding 归零、无圆角）", () => {
    const doc = htmlToFigmaDocument("<div><p>无样式</p></div>");
    const frame = firstNode(doc);
    expect(frame.fills).toBeUndefined();
    expect(frame.paddingTop).toBe(0);
    expect(frame.cornerRadius ?? 0).toBe(0);
  });

  it("非标准 / 未闭合 HTML 不崩溃且仍有节点", () => {
    const html = "<div><span>未闭合<p>错乱<button>";
    expect(() => htmlToFigmaDocument(html)).not.toThrow();
    expect(canvasChildrenOf(html).length).toBeGreaterThan(0);
  });

  it("未知标签降级为 FRAME（不丢节点）", () => {
    const doc = htmlToFigmaDocument("<custom-widget>内容</custom-widget>");
    expect(firstNode(doc).type).toBe("FRAME");
  });

  it("整棵树的节点 id 唯一", () => {
    const doc = htmlToFigmaDocument(
      "<div><p>a</p><p>b</p><button>c</button><section><p>d</p></section></div>",
    );
    const ids: string[] = [];
    const walk = (n: FigmaNode) => {
      ids.push(n.id);
      for (const c of kids(n)) walk(c);
    };
    walk(doc.children[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("figmaDocumentToJson", () => {
  it("输出可被 JSON.parse 的合法字符串，结构保真", () => {
    const doc = htmlToFigmaDocument('<div class="bg-blue-500"><p>Hi</p></div>');
    const json = figmaDocumentToJson(doc);
    const parsed = JSON.parse(json) as { type: string; children: unknown[] };
    expect(parsed.type).toBe("DOCUMENT");
    expect(Array.isArray(parsed.children)).toBe(true);
    expect(json).toContain("CANVAS");
  });

  it("美化输出（含换行缩进），便于人工阅读/复制", () => {
    const json = figmaDocumentToJson(htmlToFigmaDocument("<div></div>"));
    expect(json).toContain("\n");
    expect(json.includes("  ")).toBe(true);
  });
});
