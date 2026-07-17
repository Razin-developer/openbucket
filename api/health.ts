import { handleHealth } from "../server/auth/service.js";

export async function GET(request: Request): Promise<Response> {
  return handleHealth(request);
}
