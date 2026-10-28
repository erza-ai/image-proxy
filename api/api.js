function getToken(env) {
  if (env && typeof env.PROXY_TOKEN === "string") {
    return env.PROXY_TOKEN;
  }
  if (typeof process !== "undefined" && process?.env?.PROXY_TOKEN) {
    return process.env.PROXY_TOKEN;
  }
  if (typeof Deno !== "undefined" && Deno?.env?.get) {
    return Deno.env.get("PROXY_TOKEN") || "";
  }
  if (typeof Netlify !== "undefined" && Netlify?.env?.get) {
    return Netlify.env.get("PROXY_TOKEN") || "";
  }
  return "";
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

export async function handler(request, env) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");
  const token = searchParams.get("token");
  const proxyToken = getToken(env);

  if (!proxyToken || token !== proxyToken) {
    return new Response("forbidden", { status: 403 });
  }
  if (!target) {
    return new Response("missing url", { status: 400 });
  }

  let u;
  try {
    u = new URL(target);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return new Response("bad scheme", { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetch(u.toString(), {
      headers: { "User-Agent": UA, Accept: ACCEPT },
      redirect: "follow",
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }

  if (!upstream.ok) {
    return new Response("upstream " + upstream.status, { status: 502 });
  }

  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  if (!ct.startsWith("image/")) {
    return new Response("not an image", { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: { "Content-Type": ct, "Cache-Control": "public, max-age=86400" },
  });
}

export default {
  fetch: handler,
};

export const config = { runtime: "edge" }; // Vercel Edge (ignored elsewhere)

// Deno Deploy / local Deno: start a server when executed directly.
if (typeof Deno !== "undefined" && typeof Netlify === "undefined") {
  Deno.serve(handler);
}
