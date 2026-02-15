import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import contract from "./generated/bot-api-contract.generated.json";
import generatedMethods from "./generated/bot-api-methods.generated.json";

type JsonObject = Record<string, unknown>;

function getObjectProperty(
  source: JsonObject,
  key: string,
): Record<string, unknown> | null {
  const value = source[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getMethodSchemaMap(schema: JsonObject): Record<string, unknown> {
  const properties = getObjectProperty(schema, "properties");
  if (!properties) {
    throw new Error("Invalid generated Bot API schema: missing properties");
  }
  return properties;
}

function buildWrapperSchema(
  method: string,
  methodSchema: unknown,
  rootSchema: JsonObject,
): JsonObject {
  const wrapper: JsonObject = {
    type: "object",
    additionalProperties: false,
    required: [method],
    properties: {
      [method]: methodSchema,
    },
  };
  const definitions = rootSchema.definitions;
  if (definitions && typeof definitions === "object" && !Array.isArray(definitions)) {
    wrapper.definitions = definitions;
  }
  const defs = rootSchema.$defs;
  if (defs && typeof defs === "object" && !Array.isArray(defs)) {
    wrapper.$defs = defs;
  }
  return wrapper;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "unknown schema validation error";
  }
  return errors
    .map((err) => {
      const path = err.instancePath || "/";
      return `${path} ${err.message ?? "validation error"}`;
    })
    .join("; ");
}

const contractFile = contract as unknown as {
  methodInputMapSchema?: JsonObject;
};

const rootSchema = contractFile.methodInputMapSchema;
if (!rootSchema) {
  throw new Error("Generated Bot API contract missing methodInputMapSchema");
}

const methodSchemaMap = getMethodSchemaMap(rootSchema);
const methodNames = generatedMethods.methods.slice().sort((left, right) =>
  left.localeCompare(right, "en"),
);

const ajv = new Ajv({
  strict: true,
  allErrors: true,
  allowUnionTypes: true,
  validateFormats: false,
});

const validators = new Map<string, ValidateFunction>();
for (const method of methodNames) {
  const schema = methodSchemaMap[method];
  if (!schema) {
    throw new Error(`Missing generated schema for method: ${method}`);
  }
  validators.set(method, ajv.compile(buildWrapperSchema(method, schema, rootSchema)));
}

export function getKnownBotSchemaMethods(): string[] {
  return methodNames.slice();
}

export function validateBotMethodInput(
  method: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const validator = validators.get(method);
  if (!validator) {
    throw new Error(`No JSON schema registered for Telegram method: ${method}`);
  }
  const wrapper = {
    [method]: payload,
  };
  const valid = validator(wrapper);
  if (!valid) {
    throw new Error(
      `Invalid payload for method ${method}: ${formatAjvErrors(validator.errors)}`,
    );
  }
  return payload;
}
