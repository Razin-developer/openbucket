import { handleSession } from "../../server/auth/service.js";

export async function GET(request: Request): Promise<Response> {
  return handleSession(request);
}
