import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  buildStructureExpression,
  findChromePath,
  parseDevToolsEndpoint,
  parseStructureJson,
  renderUiStructure,
  summarizeUiStructure,
  type UiElement,
  type UiStructure,
} from "./dom";

describe("findChromePath", () => {
  it("优先采用 CHROME_PATH（存在时）", () => {
    expect(
      findChromePath({ CHROME_PATH: process.execPath }, process.platform),
    ).toBe(process.execPath);
  });

  it("CHROME_PATH 指向不存在的文件时忽略它", () => {
    const bogus = "Z:\\definitely\\missing\\chrome.exe";
    expect(findChromePath({ CHROME_PATH: bogus }, process.platform)).not.toBe(
      bogus,
    );
  });

  it("未知平台无候选 → null", () => {
    expect(findChromePath({}, "plan9")).toBeNull();
  });
});

describe("parseDevToolsEndpoint", () => {
  it("从 DevTools 行解析出 ws 端点", () => {
    expect(
      parseDevToolsEndpoint(
        "DevTools listening on ws://127.0.0.1:51234/devtools/browser/abc-def",
      ),
    ).toBe("ws://127.0.0.1:51234/devtools/browser/abc-def");
  });

  it("非该行返回 null", () => {
    expect(parseDevToolsEndpoint("just a log line")).toBeNull();
  });
});

describe("buildStructureExpression", () => {
  it("使用 getComputedStyle 且带上元素上限", () => {
    const expr = buildStructureExpression(12);
    expect(expr).toContain("getComputedStyle");
    expect(expr).toContain("slice(0, 12)");
  });
});

describe("parseStructureJson", () => {
  const element = {
    tag: "div",
    cls: "a",
    text: "x",
    color: "rgb(0,0,0)",
    background: "rgba(0,0,0,0)",
    fontSize: "16px",
    fontWeight: "400",
    padding: "0px",
    borderRadius: "0px",
    display: "block",
  };

  it("解析合法结构并带入 url", () => {
    const raw = JSON.stringify({ title: "T", total: 3, elements: [element] });
    const s = parseStructureJson(raw, "https://x.com");
    expect(s?.title).toBe("T");
    expect(s?.totalElements).toBe(3);
    expect(s?.elements).toHaveLength(1);
    expect(s?.url).toBe("https://x.com");
  });

  it("坏 JSON / 缺 elements → null", () => {
    expect(parseStructureJson("not json", "u")).toBeNull();
    expect(parseStructureJson('{"title":"t"}', "u")).toBeNull();
  });

  it("过滤形状不符的元素，保留合法项", () => {
    const raw = JSON.stringify({
      title: "T",
      total: 2,
      elements: [{ tag: "div" }, { tag: "p", color: "c", fontSize: "1px" }],
    });
    const s = parseStructureJson(raw, "u");
    expect(s?.elements).toHaveLength(1);
    expect(s?.elements[0].tag).toBe("p");
  });
});

describe("summarizeUiStructure", () => {
  const el = (over: Partial<UiElement>): UiElement => ({
    tag: "div",
    cls: "",
    text: "",
    color: "rgb(0,0,0)",
    background: "rgba(0,0,0,0)",
    fontSize: "16px",
    fontWeight: "400",
    padding: "0px",
    borderRadius: "0px",
    display: "block",
    ...over,
  });
  const structure: UiStructure = {
    url: "u",
    title: "Acme",
    totalElements: 2,
    elements: [
      el({ tag: "h1", cls: "title", text: "Hello", fontSize: "32px", fontWeight: "700" }),
      el({ tag: "button", cls: "btn primary", text: "Buy", background: "rgb(37,99,235)" }),
    ],
  };

  it("含标题、元素数与关键样式", () => {
    const text = summarizeUiStructure(structure);
    expect(text).toContain("页面结构与样式");
    expect(text).toContain("Acme");
    expect(text).toContain("可见元素数：2");
    expect(text).toContain("32px");
    expect(text).toContain("rgb(37,99,235)");
  });

  it("受 maxChars 约束", () => {
    expect(summarizeUiStructure(structure, 60).length).toBeLessThanOrEqual(60);
  });
});

const chromePath = findChromePath();
describe.skipIf(!chromePath)("renderUiStructure（集成：需要本机浏览器）", () => {
  let server: Server | null = null;

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
  });

  it(
    "无头渲染真实 HTTP 页面并取回 computed styles",
    async () => {
      const html = `<!doctype html><html><head><title>Fixture</title><style>
        .card{padding:20px;border-radius:12px}
        h1{font-size:30px;font-weight:700;color:rgb(15,23,42)}
      </style></head><body>
        <div class="card"><h1>Hello Headless</h1><button style="background:rgb(37,99,235)">Go</button></div>
      </body></html>`;

      const started = await new Promise<{ server: Server; port: number }>(
        (resolve) => {
          const s = createServer((_req, res) => {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
          });
          s.listen(0, "127.0.0.1", () => {
            resolve({ server: s, port: (s.address() as AddressInfo).port });
          });
        },
      );
      server = started.server;

      const structure = await renderUiStructure(
        `http://127.0.0.1:${started.port}/`,
        { timeoutMs: 30_000 },
      );

      expect(structure.title).toBe("Fixture");
      expect(structure.elements.length).toBeGreaterThan(0);
      const h1 = structure.elements.find((e) => e.tag === "h1");
      expect(h1?.fontSize).toBe("30px");
      expect(h1?.fontWeight).toBe("700");
      const card = structure.elements.find((e) => e.cls.includes("card"));
      expect(card?.padding).toBe("20px");
      expect(card?.borderRadius).toBe("12px");
    },
    40_000,
  );
});
