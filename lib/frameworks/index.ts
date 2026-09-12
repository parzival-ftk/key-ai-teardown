import { fiveForces } from "./five-forces";
import { swot } from "./swot";
import { jtbd } from "./jtbd";
import { businessCanvas } from "./business-canvas";
import { aarrr } from "./aarrr";
import { interviewer } from "./interviewer";
import { competitorProfiles } from "./competitor-profiles";
import type { FrameworkTemplate } from "./types";

export {
  fiveForces,
  swot,
  jtbd,
  businessCanvas,
  aarrr,
  interviewer,
  competitorProfiles,
};
export { renderBrief, OUTPUT_RULES } from "./types";
export type { FrameworkTemplate } from "./types";

/** 全部框架，按 id 索引（供编排层与可视化取用） */
export const FRAMEWORKS: Record<string, FrameworkTemplate> = {
  [fiveForces.id]: fiveForces,
  [swot.id]: swot,
  [jtbd.id]: jtbd,
  [businessCanvas.id]: businessCanvas,
  [aarrr.id]: aarrr,
  [interviewer.id]: interviewer,
  [competitorProfiles.id]: competitorProfiles,
};

export const FRAMEWORK_LIST: FrameworkTemplate[] = Object.values(FRAMEWORKS);
