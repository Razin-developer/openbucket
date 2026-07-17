import { next } from "@vercel/functions";

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*"],
  runtime: "nodejs",
};

export default async function middleware(request: Request): Promise<Response> {
  try {
    const { authenticateRequest } = await import("./server/auth/service");
    const user = await authenticateRequest(request);
    if (user) {
      return next({
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      });
    }
    const current = new URL(request.url);
    const login = new URL("/login", current.origin);
    login.searchParams.set("next", `${current.pathname}${current.search}`);
    return Response.redirect(login, 307);
  } catch {
    return new Response("Authentication service unavailable.", {
      status: 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "30",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }
}
