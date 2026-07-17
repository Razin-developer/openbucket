import { handleDeleteNode, handleUpdateNode } from "../../server/control-plane/service.js";

function nodeId(request: Request): string {
  return new URL(request.url).pathname.match(/^\/api\/nodes\/([a-f0-9]{24})\/?$/)?.[1] ?? "";
}

export async function PATCH(request: Request): Promise<Response> {
  return handleUpdateNode(request, nodeId(request));
}

export async function DELETE(request: Request): Promise<Response> {
  return handleDeleteNode(request, nodeId(request));
}
