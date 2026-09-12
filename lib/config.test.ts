import { describe, it, expect } from "vitest";
import {
  getLLMConfigStatus,
  readLLMEnv,
  createProviderFromEnv,
  PROVIDER_PRESETS,
} from "./config";
import { LLMError } from "./llm/provider";

const FULL_ENV = {
  LLM_BASE_URL: "https://api.deepseek.com/v1",
  LLM_API_KEY: "sk-x",
  LLM_MODEL: "deepseek-chat",
};

describe("LLM 配置读取", () => {
  it("缺 key 时报告缺口", () => {
    const status = getLLMConfigStatus({});
    expect(status.configured).toBe(false);
    expect(status.missing).toContain("LLM_API_KEY");
    expect(status.missing).toContain("LLM_BASE_URL");
    expect(status.missing).toContain("LLM_MODEL");
  });

  it("完整配置时 configured 为 true 且缺省为空", () => {
    const status = getLLMConfigStatus(FULL_ENV);
    expect(status.configured).toBe(true);
    expect(status.missing).toEqual([]);
    expect(status.model).toBe("deepseek-chat");
  });

  it("readLLMEnv 未配置完整返回 null", () => {
    expect(readLLMEnv({})).toBeNull();
  });

  it("createProviderFromEnv 未配置时抛 LLMError", () => {
    expect(() => createProviderFromEnv({})).toThrow(
      LLMError,
    );
  });

  it("createProviderFromEnv 配置完整时返回 provider", () => {
    const provider = createProviderFromEnv(FULL_ENV);
    expect(provider.model).toBe("deepseek-chat");
    expect(provider.id).toBe("openai-compatible");
  });

  it("提供四家厂商预设", () => {
    expect(Object.keys(PROVIDER_PRESETS)).toEqual([
      "deepseek",
      "openai",
      "qwen",
      "zhipu",
    ]);
    expect(PROVIDER_PRESETS.deepseek.baseURL).toContain("deepseek.com");
  });
});
