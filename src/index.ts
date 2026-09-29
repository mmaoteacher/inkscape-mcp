import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { tools } from "./tools/index.ts";

const server = new McpServer({ name: "inkscape-mcp", version: "0.1.0" });

for (const tool of tools) {
  server.tool(tool.name, tool.schema, async (args: any) => {
    return await tool.handler(args);
  });
}

const mode = process.env.MCP_TRANSPORT || "stdio";

if (mode === "http" || mode === "streamable") {
  const app = express();
  app.use(express.json());
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  app.post("/mcp", async (req, res) => {
    await transport.handleRequest(req, res, req.body);
  });
  const port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT) : 3000;
  app.listen(port, () => console.log(`inkscape-mcp Streamable HTTP on port ${port}`));
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("inkscape-mcp server running via stdio");
}
