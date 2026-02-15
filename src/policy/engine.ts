import type { AppConfig } from "../app/config.js";
import type { AppMetrics } from "../app/logger.js";
import type {
  PolicyDecision,
  Principal,
  RiskLevel,
  Role,
  ToolPermission,
} from "../types/core.js";

const riskyByRoleMinimum: Record<RiskLevel, Role[]> = {
  low: ["readonly", "operator", "admin", "owner"],
  medium: ["operator", "admin", "owner"],
  high: ["admin", "owner"],
  critical: ["admin", "owner"],
};

export class PolicyEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly metrics: AppMetrics | null,
    private readonly permissions: ToolPermission[] = [],
  ) {}

  updatePermissions(permissions: ToolPermission[]): void {
    this.permissions.splice(0, this.permissions.length, ...permissions);
  }

  evaluate(input: {
    principal: Principal;
    tool: string;
    operation: string;
    riskLevel: RiskLevel;
  }): PolicyDecision {
    const { principal, tool, operation, riskLevel } = input;

    if (tool === "telegram.bot.raw") {
      const allowedByRole = principal.roles.some((role) =>
        this.config.policy.allowRawToolForRoles.includes(role),
      );
      if (!allowedByRole) {
        this.metrics?.policyDenies.inc({ tool });
        return {
          allow: false,
          reason: "raw tool denied by role policy",
          matchedRule: null,
        };
      }
    }

    const roleAllowsRisk = principal.roles.some((role) =>
      riskyByRoleMinimum[riskLevel].includes(role),
    );
    if (!roleAllowsRisk) {
      this.metrics?.policyDenies.inc({ tool });
      return {
        allow: false,
        reason: `role does not allow ${riskLevel} risk operations`,
        matchedRule: null,
      };
    }

    const matched = this.permissions.find(
      (permission) =>
        permission.tool === tool &&
        (permission.operations.includes("*") ||
          permission.operations.includes(operation)),
    );

    if (!matched) {
      const defaultAllow = this.config.policy.defaultEffect === "allow";
      if (!defaultAllow) {
        this.metrics?.policyDenies.inc({ tool });
      }
      return {
        allow: defaultAllow,
        reason: `default policy effect: ${this.config.policy.defaultEffect}`,
        matchedRule: null,
      };
    }

    if (matched.effect === "deny") {
      this.metrics?.policyDenies.inc({ tool });
      return {
        allow: false,
        reason: "explicit deny rule matched",
        matchedRule: matched,
      };
    }

    return {
      allow: true,
      reason: "explicit allow rule matched",
      matchedRule: matched,
    };
  }
}
