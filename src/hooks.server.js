const API_ORIGIN = process.env.API_ORIGIN || "http://localhost:8067";

function buildTargetUrl(pathname, search) {
  if (pathname === "/openapi.json") {
    return new URL("/openapi.json", API_ORIGIN);
  }

  return new URL(`${pathname}${search}`, API_ORIGIN);
}

export async function handle({ event, resolve }) {
  const { pathname, search } = event.url;
  const shouldProxy = pathname.startsWith("/api/") || pathname === "/openapi.json";

  if (!shouldProxy) {
    return resolve(event);
  }

  const targetUrl = buildTargetUrl(pathname, search);

  try {
    const headers = new Headers(event.request.headers);
    headers.set("host", targetUrl.host);

    let body;
    if (event.request.method !== "GET" && event.request.method !== "HEAD") {
      body = await event.request.arrayBuffer();
    }

    const upstream = await fetch(targetUrl, {
      method: event.request.method,
      headers,
      body
    });

    const responseHeaders = new Headers(upstream.headers);
    if (pathname.startsWith("/api/")) {
      responseHeaders.set("Access-Control-Allow-Origin", "*");
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return Response.json(
      {
        error: pathname === "/openapi.json" ? "Cannot fetch OpenAPI spec" : "Gateway request failed",
        message: error?.message || "Unknown error"
      },
      { status: 502 }
    );
  }
}
