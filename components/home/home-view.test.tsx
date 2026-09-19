// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { HomeView } from "./HomeView";
import { EXAMPLE_PROJECT_ID } from "@/lib/components/demo-project";
import { listProjects } from "@/lib/components/project-store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("HomeView", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    window.localStorage.clear();
    pushMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
  const mount = async () => {
    await act(async () => {
      root.render(<HomeView />);
    });
  };

  it("展示 Create / Example 入口，并自动安装示例项目", async () => {
    await mount();
    expect($("[data-home-create]")).not.toBeNull();
    expect($("[data-home-example]")).not.toBeNull();
    expect(container.querySelector(`[data-home-project="${EXAMPLE_PROJECT_ID}"]`)).not.toBeNull();
  });

  it("Create Project 新建空白项目并跳转工作区", async () => {
    await mount();
    act(() => $("[data-home-create]").click());
    expect(pushMock).toHaveBeenCalledTimes(1);
    const target = pushMock.mock.calls[0][0] as string;
    expect(target.startsWith("/project/")).toBe(true);
    const created = listProjects(window.localStorage).find(
      (p) => p.id === target.replace("/project/", ""),
    );
    expect(created?.source).toBe("blank");
  });

  it("Example Project 跳转到示例工作区", async () => {
    await mount();
    act(() => $("[data-home-example]").click());
    expect(pushMock).toHaveBeenCalledWith(`/project/${EXAMPLE_PROJECT_ID}`);
  });

  it("删除项目后从列表移除", async () => {
    await mount();
    expect(container.querySelector(`[data-home-project="${EXAMPLE_PROJECT_ID}"]`)).not.toBeNull();
    act(() => $(`[data-home-delete="${EXAMPLE_PROJECT_ID}"]`).click());
    expect(container.querySelector(`[data-home-project="${EXAMPLE_PROJECT_ID}"]`)).toBeNull();
    expect($("[data-home-empty]")).not.toBeNull();
  });
});
