import { handleHealth } from "../server/auth/service";

export async function GET(request: Request): Promise<Response> {
  return handleHealth(request);
}
