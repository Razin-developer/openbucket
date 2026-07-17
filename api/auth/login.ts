import { handleLogin } from "../../server/auth/service.js";

export async function POST(request: Request): Promise<Response> {
  return handleLogin(request);
}
