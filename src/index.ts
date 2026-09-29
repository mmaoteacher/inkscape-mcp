import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { tools } from "./tools/index.ts";

const server = new McpServer({ name: "inkscape-mcp", version: "0.1.0" });

for (const tool of tools) {
  (server as any).tool(tool.name, (tool.schema as any).shape || {}, async (extra: any) => tool.handler(extra));
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.log("inkscape-mcp server running via stdio");
