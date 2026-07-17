import { handleSession } from "../../server/auth/service";

export async function GET(request: Request): Promise<Response> {
  return handleSession(request);
}
