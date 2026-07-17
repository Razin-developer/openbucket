import { handleNodeHeartbeat } from "../../server/control-plane/service.js";

export async function POST(request: Request): Promise<Response> {
  return handleNodeHeartbeat(request);
}
