import { handleUsage } from "../server/control-plane/service.js";

export async function GET(request: Request): Promise<Response> {
  return handleUsage(request);
}
