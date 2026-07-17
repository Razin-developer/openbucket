import { handleLogin } from "../../server/auth/service";

export async function POST(request: Request): Promise<Response> {
  return handleLogin(request);
}
