import { describe, it, expect } from "vitest";
import { componentPrompt, derivePrompt } from "./prompt";
import { componentBreadcrumb, componentFields, componentStats, treeOverview } from "./inspector-fields";
import { createExampleProject } from "./demo-project";
import { treeFromRaw, findComponent } from "./tree";

const project = createExampleProject(1000);
const tree = project.tree;

function nodeByName(name: string) {
  const found = Object.values(tree.nodes).find((n) => n.name === name);
  if (!found) throw new Error(`未找到组件 ${name}`);
  return found;
}

describe("derivePrompt", () => {
  it("有 visualDescription 时直接用它", () => {
    const search = nodeByName("SearchBox");
    expect(derivePrompt(search)).toBe(
      "Rounded pill-shaped search input with a magnifier icon and soft blue glow",
    );
  });

  it("无 visualDescription 时由名称/角色/文案/风格确定性拼装", () => {
    const node = treeFromRaw({
      name: "PrimaryButton",
      rect: { x: 0, y: 0, width: 10, height: 10 },
      children: [],
      properties: { role: "primary button", text: "Get started", style: "rounded, blue accent" },
    }).nodes.n1;
    expect(derivePrompt(node)).toBe(
      'PrimaryButton, primary button, with the text "Get started", rounded, blue accent, page UI element',
    );
  });

  it("仅有名称时也返回可用 prompt", () => {
    const node = treeFromRaw({ name: "Header" }).nodes.n1;
    expect(derivePrompt(node)).toBe("Header, page UI element");
  });
});

describe("componentPrompt", () => {
  it("自带 prompt 优先", () => {
    const illustration = nodeByName("Illustration");
    expect(componentPrompt(tree, illustration.id)).toBe(illustration.prompt);
  });

  it("无自带 prompt 时回落到推导", () => {
    const header = nodeByName("Header");
    expect(componentPrompt(tree, header.id)).toContain("Header");
  });

  it("不存在的组件返回空串", () => {
    expect(componentPrompt(tree, "nope")).toBe("");
  });
});

describe("componentFields", () => {
  it("给出 6 个字段并保留空值字段", () => {
    const header = nodeByName("Header");
    const fields = componentFields(header);
    expect(fields.map((f) => f.key)).toEqual([
      "name",
      "type",
      "role",
      "description",
      "text",
      "style",
    ]);
    expect(fields.find((f) => f.key === "name")?.value).toBe("Header");
    expect(fields.find((f) => f.key === "type")?.value).toBe("区块");
    expect(fields.find((f) => f.key === "role")?.value).toBe("site header");
  });

  it("缺失属性展示为空串而非 undefined", () => {
    const features = nodeByName("Features");
    const fields = componentFields(features);
    expect(fields.find((f) => f.key === "text")?.value).toBe("");
    expect(fields.find((f) => f.key === "style")?.value).toBe("");
  });
});

describe("componentBreadcrumb / componentStats / treeOverview", () => {
  it("面包屑从根到自身", () => {
    const search = nodeByName("SearchBox");
    expect(componentBreadcrumb(tree, search.id)).toEqual(["Landing Page", "Hero", "SearchBox"]);
  });

  it("深度与子组件数", () => {
    const hero = nodeByName("Hero");
    expect(componentStats(tree, hero.id)).toEqual({ depth: 1, childCount: 3 });
  });

  it("整树概览", () => {
    const overview = treeOverview(tree);
    expect(overview.total).toBe(8);
    expect(overview.byType.page).toBe(1);
    expect(findComponent(tree, tree.rootId)?.name).toBe("Landing Page");
  });
});
