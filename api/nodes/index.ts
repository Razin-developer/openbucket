import { handleCreateNode, handleListNodes } from "../../server/control-plane/service.js";

export async function GET(request: Request): Promise<Response> {
  return handleListNodes(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateNode(request);
}
