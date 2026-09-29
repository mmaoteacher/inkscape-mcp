import { z } from "zod";

export const traceSchema = z.object({
  inputPath: z.string(),
  outputPath: z.string().optional(),
});

export async function traceBitmap(args: z.infer<typeof traceSchema>) {
  return {
    content: [{ type: "text" as const, text: `Trace bitmap: ${args.inputPath} → ${args.outputPath || "auto"}` }],
  };
}
