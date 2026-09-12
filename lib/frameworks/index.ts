import { fiveForces } from "./five-forces";
import { swot } from "./swot";
import { jtbd } from "./jtbd";
import { businessCanvas } from "./business-canvas";
import { aarrr } from "./aarrr";
import { interviewer } from "./interviewer";
import { competitorProfiles } from "./competitor-profiles";
import { devilsAdvocate } from "./devils-advocate";
import { synthesis } from "./synthesis";
import { prd } from "./prd";
import type { FrameworkTemplate } from "./types";

export {
  fiveForces,
  swot,
  jtbd,
  businessCanvas,
  aarrr,
  interviewer,
  competitorProfiles,
  devilsAdvocate,
  synthesis,
  prd,
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
  [devilsAdvocate.id]: devilsAdvocate,
  [synthesis.id]: synthesis,
  [prd.id]: prd,
};

export const FRAMEWORK_LIST: FrameworkTemplate[] = Object.values(FRAMEWORKS);
