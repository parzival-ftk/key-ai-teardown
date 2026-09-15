// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceNav } from "./ResourceNav";
import { countResources, loadResourceDataset } from "@/lib/resources/ui-resources";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dataset = loadResourceDataset();

describe("ResourceNav（服务端静态渲染）", () => {
  const html = renderToStaticMarkup(<ResourceNav />);

  it("默认「全部」：渲染 5 个分类分组与全部 22 张卡片", () => {
    expect(html).toContain("data-resource-nav");
    expect((html.match(/data-resource-group=/g) ?? []).length).toBe(5);
    expect((html.match(/data-resource-card=/g) ?? []).length).toBe(
      countResources(dataset),
    );
  });

  it("分类 Tabs：全部 + 5 个分类", () => {
    expect((html.match(/data-resource-tab=/g) ?? []).length).toBe(6);
    expect(html).toContain('data-resource-tab="all"');
    expect(html).toContain('data-resource-tab="colors-and-icons"');
    expect(html).toContain("全部");
  });

  it("卡片外链安全属性齐全", () => {
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("每张卡片 4 个标签 Badge", () => {
    const cards = html.match(/data-resource-card=/g) ?? [];
    expect((html.match(/data-resource-tag/g) ?? []).length).toBe(cards.length * 4);
  });
});

describe("ResourceNav 交互（jsdom）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mount = () => act(() => root.render(<ResourceNav />));
  const click = (selector: string) =>
    act(() => (container.querySelector(selector) as HTMLElement).click());
  const cards = () => container.querySelectorAll("[data-resource-card]");
  const search = () =>
    container.querySelector("[data-resource-search]") as HTMLInputElement;
  const type = (value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(search(), value);
      search().dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("切换分类只保留该分类卡片", () => {
    mount();
    expect(cards()).toHaveLength(countResources(dataset));
    click('[data-resource-tab="colors-and-icons"]');
    expect(cards()).toHaveLength(4);
    expect(container.querySelectorAll("[data-resource-group]")).toHaveLength(1);
    expect(
      container
        .querySelector('[data-resource-tab="colors-and-icons"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("关键字实时搜索：命中名称 / 标签 / 简介", () => {
    mount();
    type("mobbin");
    expect(cards()).toHaveLength(1);
    expect(
      (container.querySelector("[data-resource-card]") as HTMLElement).getAttribute(
        "data-resource-card",
      ),
    ).toBe("mobbin");

    type("渐变");
    expect(cards().length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Mesh Gradients");

    type("TOTALLY-NO-MATCH");
    expect(cards()).toHaveLength(0);
    expect(container.querySelector("[data-resource-empty]")).not.toBeNull();
  });

  it("分类与搜索叠加；清空搜索恢复", () => {
    mount();
    click('[data-resource-tab="colors-and-icons"]');
    type("coolors");
    expect(cards()).toHaveLength(1);
    type("");
    expect(cards()).toHaveLength(4);
    click('[data-resource-tab="all"]');
    expect(cards()).toHaveLength(countResources(dataset));
  });

  it("计数随筛选更新", () => {
    mount();
    expect(container.querySelector("[data-resource-count]")?.textContent).toContain(
      `共 ${countResources(dataset)} / ${countResources(dataset)}`,
    );
    click('[data-resource-tab="system-and-naming"]');
    expect(container.querySelector("[data-resource-count]")?.textContent).toContain(
      "共 4 / 22",
    );
  });
});
