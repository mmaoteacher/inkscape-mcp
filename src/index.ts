import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { tools } from "./tools/index.ts";

const server = new McpServer({ name: "inkscape-mcp", version: "0.1.0" });

for (const tool of tools) {
  const rawSchema = (tool.schema as any)._def?.typeName === "ZodObject"
    ? (tool.schema as any).shape || {}
    : (Object.keys((tool.schema as any)?.shape || {}).length > 0 ? (tool.schema as any).shape : tool.schema);
  server.tool(
    tool.name,
    (tool as any).description || "",
    rawSchema,
    async (args: any) => {
      return await tool.handler(args);
    },
  );
}

const mode = process.env.MCP_TRANSPORT || "stdio";

if (mode === "http" || mode === "streamable") {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  // node:http is used directly so the server has no web framework dependency.
  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (!raw) return resolve(undefined);
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method !== "POST" || !url.startsWith("/mcp")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    try {
      const body = await readBody(req);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(400, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  const port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000;
  httpServer.listen(port, () => console.log(`inkscape-mcp Streamable HTTP on port ${port}`));
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("inkscape-mcp server running via stdio");
}
