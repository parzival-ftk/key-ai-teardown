import { describe, it, expect } from "vitest";
import {
  getLLMConfigStatus,
  readLLMEnv,
  createProviderFromEnv,
  PROVIDER_PRESETS,
  LLMConfigError,
  sanitizeEnvValue,
} from "./config";

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

  it("createProviderFromEnv 未配置时抛 LLMConfigError", () => {
    expect(() => createProviderFromEnv({})).toThrow(LLMConfigError);
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

describe("sanitizeEnvValue（配置容错）", () => {
  it("剥掉成对包裹符与首尾空白", () => {
    expect(sanitizeEnvValue("  sk-abc  ")).toBe("sk-abc");
    expect(sanitizeEnvValue("<sk-abc>")).toBe("sk-abc");
    expect(sanitizeEnvValue('"sk-abc"')).toBe("sk-abc");
    expect(sanitizeEnvValue("'sk-abc'")).toBe("sk-abc");
    expect(sanitizeEnvValue("`sk-abc`")).toBe("sk-abc");
    expect(sanitizeEnvValue(undefined)).toBeUndefined();
  });

  it("不成对或非包裹符不加改动", () => {
    expect(sanitizeEnvValue("<sk-abc")).toBe("<sk-abc");
    expect(sanitizeEnvValue("sk-abc>")).toBe("sk-abc>");
    expect(sanitizeEnvValue("https://api.deepseek.com/v1")).toBe(
      "https://api.deepseek.com/v1",
    );
  });

  it("readLLMEnv 能剥离被尖括号包裹的 key（真实踩过的坑：<sk-...> 导致 401）", () => {
    const cfg = readLLMEnv({
      LLM_BASE_URL: "<https://api.deepseek.com/v1>",
      LLM_API_KEY: "<sk-0d5d4f0991a348049ef8da38043e4c11>",
      LLM_MODEL: " deepseek-chat ",
    });

    expect(cfg?.LLM_API_KEY).toBe("sk-0d5d4f0991a348049ef8da38043e4c11");
    expect(cfg?.LLM_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(cfg?.LLM_MODEL).toBe("deepseek-chat");
  });
});
