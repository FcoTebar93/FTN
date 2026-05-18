import { describe, expect, it } from "vitest";
import {
  buildDefaultInputFromSchema,
  isFormRenderableSchema,
  mergeInputWithSchema,
  validateFormInput,
} from "./json-schema-input";
import type { JsonSchema } from "../api/types";

const signupSchema: JsonSchema = {
  type: "object",
  required: ["email", "planName", "priceCents"],
  properties: {
    email: { type: "string", format: "email" },
    planName: { type: "string" },
    priceCents: { type: "integer", minimum: 0 },
  },
};

describe("json-schema-input", () => {
  it("isFormRenderableSchema acepta objetos planos", () => {
    expect(isFormRenderableSchema(signupSchema)).toBe(true);
    expect(isFormRenderableSchema({ type: "object", properties: { x: { type: "object" } } })).toBe(false);
  });

  it("buildDefaultInputFromSchema rellena tipos básicos", () => {
    expect(buildDefaultInputFromSchema(signupSchema)).toEqual({
      email: "",
      planName: "",
      priceCents: 0,
    });
  });

  it("mergeInputWithSchema combina ejemplo con defaults", () => {
    expect(
      mergeInputWithSchema(signupSchema, { email: "a@b.com", planName: "Pro", priceCents: 100 })
    ).toEqual({ email: "a@b.com", planName: "Pro", priceCents: 100 });
  });

  it("validateFormInput detecta required y email", () => {
    expect(validateFormInput(signupSchema, { email: "", planName: "Pro", priceCents: 10 })).toEqual({
      email: "required",
    });
    expect(validateFormInput(signupSchema, { email: "bad", planName: "Pro", priceCents: 10 })).toEqual({
      email: "email",
    });
  });
});
