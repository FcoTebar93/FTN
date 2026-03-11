import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { RenderPdfFromTemplateInput, RenderPdfFromTemplateResult } from "./types";

export function renderPdfFromTemplateActivityDefinition(): ActivityDefinition<RenderPdfFromTemplateInput, RenderPdfFromTemplateResult> {
  return {
    name: "documents.renderPdfFromTemplate:v1",
    maxAttempts: 2,
    timeoutMs: 60_000,
    tags: ["documents", "pdf", "templates"],
    version: "v1",
    async execute(
      input: RenderPdfFromTemplateInput,
      ctx: ActivityExecutionContext
    ): Promise<RenderPdfFromTemplateResult> {
      ctx.log("Renderizando PDF desde plantilla", {
        templateId: input.templateId,
        outputName: input.outputName,
      });

      const safeName = encodeURIComponent(input.outputName);
      const pdfUrl = `https://cdn.example.com/pdfs/${input.templateId}/${safeName}.pdf`;

      return { pdfUrl };
    },
  };
}