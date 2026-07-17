import { handleResolveNode } from "../../server/control-plane/service.js";

export async function GET(request: Request): Promise<Response> {
  return handleResolveNode(request);
}
