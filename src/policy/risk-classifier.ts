import type { RiskLevel } from "../types/core.js";

interface Rule {
  pattern: RegExp;
  riskLevel: RiskLevel;
}

const RULES: Rule[] = [
  { pattern: /\.(ban|unban|promote|demote|delete|remove|revoke)$/i, riskLevel: "high" },
  { pattern: /\.approval\./i, riskLevel: "critical" },
  { pattern: /\.privacy\./i, riskLevel: "high" },
  { pattern: /\.join/i, riskLevel: "high" },
  { pattern: /\.(create|invite|import|export|archive|unarchive)$/i, riskLevel: "medium" },
  { pattern: /\.(update|edit|set|pin|unpin|forward|reply|react)$/i, riskLevel: "medium" },
  { pattern: /\.media\.(upload|download)/i, riskLevel: "medium" },
];

export function classifyRisk(input: {
  tool: string;
  operation: string;
  defaultRisk?: RiskLevel;
}): RiskLevel {
  const key = `${input.tool}.${input.operation}`;
  for (const rule of RULES) {
    if (rule.pattern.test(key)) {
      return rule.riskLevel;
    }
  }
  return input.defaultRisk ?? "low";
}
