import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiQuery } from "@nestjs/swagger";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { z } from "zod";

// Konversi Zod schema → OpenAPI 3.0 schema object.
// Pakai converter built-in Zod v4 (`z.toJSONSchema`) — `zod-to-json-schema` v3
// hanya support Zod v3 dan return `{}` kosong untuk Zod v4.
//   - target "draft-7"   → paling kompatibel dengan OpenAPI 3.0
//   - unrepresentable    → kalau ada tipe yang tak bisa diserialize, fallback ke `any`
function toOpenApiSchema(schema: unknown): Record<string, unknown> {
  const json = z.toJSONSchema(schema as z.ZodType, {
    target: "draft-7",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  // `$schema` property tidak relevan di dalam OpenAPI spec.
  delete json.$schema;
  return json;
}

export function ApiZodBody(schema: unknown) {
  const jsonSchema = toOpenApiSchema(schema);
  return applyDecorators(ApiBody({ schema: jsonSchema as SchemaObject }));
}

export function ApiZodQuery(schema: unknown) {
  const jsonSchema = toOpenApiSchema(schema);

  const properties = (jsonSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((jsonSchema.required ?? []) as string[]);
  const decorators: MethodDecorator[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const queryOpts: Record<string, unknown> = {
      name,
      required: required.has(name),
      schema: prop,
    };
    if (prop.default !== undefined) queryOpts.example = prop.default;
    if (prop.description) queryOpts.description = prop.description;
    if (prop.enum) queryOpts.enum = prop.enum;
    decorators.push(ApiQuery(queryOpts as Parameters<typeof ApiQuery>[0]));
  }

  return applyDecorators(...decorators);
}
