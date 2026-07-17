import { handleRotateNodeToken } from "../../../server/control-plane/service.js";

function nodeId(request: Request): string {
  return new URL(request.url).pathname.match(/^\/api\/nodes\/([a-f0-9]{24})\/rotate-token\/?$/)?.[1] ?? "";
}

export async function POST(request: Request): Promise<Response> {
  return handleRotateNodeToken(request, nodeId(request));
}
