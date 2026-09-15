import {
  EVAL_DIMENSIONS,
  compositeScore,
  type EvaluationDimension,
} from "@/lib/eval/dimensions";

/**
 * 质量门禁 eval —— 评分维度（**转发模块**）。
 *
 * W14 起维度定义与加权聚合上移到 `lib/eval/dimensions.ts`：
 * 在线质量看板（components/eval/QualityBoard）与离线 eval 管线共用同一份定义，
 * 避免「两处各写一套维度」的漂移。本文件保留原有导出名，供既有调用方无痛迁移。
 */

export const RUBRIC: EvaluationDimension[] = EVAL_DIMENSIONS;

export type RubricDimension = EvaluationDimension;
export type DimensionScores = Record<string, number>;

/** 加权综合分（见 lib/eval/dimensions 的 compositeScore） */
export const overallScore = compositeScore;
