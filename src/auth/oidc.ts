import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import type pino from "pino";
import type { AppConfig } from "../app/config.js";
import type { AppMetrics } from "../app/logger.js";
import type { Principal, Role } from "../types/core.js";

const ROLE_VALUES = new Set<Role>(["owner", "admin", "operator", "readonly"]);

function extractBearerToken(req: IncomingMessage): string | null {
  const value = req.headers.authorization;
  if (!value) {
    return null;
  }
  const [scheme, token] = value.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

function parseRoles(claims: unknown): Role[] {
  if (!Array.isArray(claims)) {
    return [];
  }
  const roles: Role[] = [];
  for (const role of claims) {
    if (typeof role === "string" && ROLE_VALUES.has(role as Role)) {
      roles.push(role as Role);
    }
  }
  return roles;
}

function extractResourceRoles(
  payload: Record<string, unknown>,
  audience: string,
): unknown {
  const resourceAccess = payload.resource_access;
  if (!resourceAccess || typeof resourceAccess !== "object") {
    return undefined;
  }
  const audienceEntry = (resourceAccess as Record<string, unknown>)[audience];
  if (!audienceEntry || typeof audienceEntry !== "object") {
    return undefined;
  }
  return (audienceEntry as Record<string, unknown>).roles;
}

export interface AuthenticatedPrincipal {
  principal: Principal;
  token: string;
}

export class OidcAuthService {
  private readonly jwks;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: pino.Logger,
    private readonly metrics: AppMetrics | null,
  ) {
    this.jwks = createRemoteJWKSet(new URL(config.auth.jwksUri));
  }

  async authenticateHttpRequest(req: IncomingMessage): Promise<AuthenticatedPrincipal> {
    const token = extractBearerToken(req);
    if (!token) {
      this.metrics?.authFailures.inc({ source: "missing_bearer" });
      throw new Error("Missing bearer token");
    }

    try {
      const verified = await jwtVerify(token, this.jwks, {
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
      });
      const payload = verified.payload as Record<string, unknown>;

      const roles = parseRoles(
        payload.roles ??
          (payload.realm_access as Record<string, unknown> | undefined)?.roles ??
          extractResourceRoles(payload, this.config.auth.audience),
      );
      const principal: Principal = {
        subject:
          typeof payload.sub === "string" && payload.sub.length > 0
            ? payload.sub
            : "unknown",
        roles: roles.length > 0 ? roles : ["readonly"],
        tenantId:
          typeof payload.tenant_id === "string" ? payload.tenant_id : "default",
        authSource: "oidc",
      };
      return { principal, token };
    } catch (error) {
      const reason =
        error instanceof joseErrors.JOSEError ? error.code : "jwt_verify_failed";
      this.metrics?.authFailures.inc({ source: reason });
      this.logger.warn({ err: error }, "OIDC authentication failed");
      throw new Error("Invalid authentication token");
    }
  }
}
