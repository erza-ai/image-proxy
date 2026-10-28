import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mod, { handler } from "../api/api.js";

// Helper to spin up a mock upstream server
async function createMockServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/valid.png") {
      const png1x1 = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64"
      );
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": png1x1.length,
      });
      res.end(png1x1);
    } else if (req.url === "/not-image.txt") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Not an image");
    } else if (req.url === "/upstream-404") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } else {
      res.writeHead(500);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("exports both default fetchable object and named handler function", () => {
  assert.equal(typeof mod, "object");
  assert.equal(typeof mod.fetch, "function");
  assert.equal(typeof handler, "function");
});

test("returns 403 when token is missing or invalid", async () => {
  process.env.PROXY_TOKEN = "secret123";
  try {
    const resNoToken = await mod.fetch(new Request("http://localhost/?url=https://example.com/a.png"));
    assert.equal(resNoToken.status, 403);
    assert.equal(await resNoToken.text(), "forbidden");

    const resWrongToken = await mod.fetch(
      new Request("http://localhost/?token=wrong&url=https://example.com/a.png")
    );
    assert.equal(resWrongToken.status, 403);
    assert.equal(await resWrongToken.text(), "forbidden");
  } finally {
    delete process.env.PROXY_TOKEN;
  }
});

test("returns 400 on missing or bad url", async () => {
  process.env.PROXY_TOKEN = "secret123";
  try {
    const resNoUrl = await mod.fetch(new Request("http://localhost/?token=secret123"));
    assert.equal(resNoUrl.status, 400);
    assert.equal(await resNoUrl.text(), "missing url");

    const resBadUrl = await mod.fetch(new Request("http://localhost/?token=secret123&url=invalid-url"));
    assert.equal(resBadUrl.status, 400);
    assert.equal(await resBadUrl.text(), "bad url");

    const resBadScheme = await mod.fetch(new Request("http://localhost/?token=secret123&url=ftp://example.com/a.png"));
    assert.equal(resBadScheme.status, 400);
    assert.equal(await resBadScheme.text(), "bad scheme");
  } finally {
    delete process.env.PROXY_TOKEN;
  }
});

test("reads PROXY_TOKEN from Cloudflare Workers env parameter", async () => {
  delete process.env.PROXY_TOKEN;
  const cfEnv = { PROXY_TOKEN: "cf-token" };

  const resForbidden = await mod.fetch(
    new Request("http://localhost/?token=wrong&url=https://example.com"),
    cfEnv
  );
  assert.equal(resForbidden.status, 403);

  const resAuthorized = await mod.fetch(
    new Request("http://localhost/?token=cf-token"),
    cfEnv
  );
  // Missing url -> 400 means token validation passed
  assert.equal(resAuthorized.status, 400);
  assert.equal(await resAuthorized.text(), "missing url");
});

test("reads PROXY_TOKEN from Deno.env global", async () => {
  delete process.env.PROXY_TOKEN;
  globalThis.Deno = {
    env: {
      get: (key) => (key === "PROXY_TOKEN" ? "deno-secret" : undefined),
    },
  };
  try {
    const resAuthorized = await mod.fetch(new Request("http://localhost/?token=deno-secret"));
    assert.equal(resAuthorized.status, 400);
    assert.equal(await resAuthorized.text(), "missing url");
  } finally {
    delete globalThis.Deno;
  }
});

test("successfully proxies image from upstream", async () => {
  const upstream = await createMockServer();
  process.env.PROXY_TOKEN = "test-token";

  try {
    const url = `${upstream.baseUrl}/valid.png`;
    const res = await mod.fetch(
      new Request(`http://localhost/?token=test-token&url=${encodeURIComponent(url)}`)
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("cache-control"), "public, max-age=86400");
    const body = await res.arrayBuffer();
    assert.equal(body.byteLength, 68);
  } finally {
    delete process.env.PROXY_TOKEN;
    await upstream.close();
  }
});

test("returns 502 when upstream is not an image", async () => {
  const upstream = await createMockServer();
  process.env.PROXY_TOKEN = "test-token";

  try {
    const url = `${upstream.baseUrl}/not-image.txt`;
    const res = await mod.fetch(
      new Request(`http://localhost/?token=test-token&url=${encodeURIComponent(url)}`)
    );

    assert.equal(res.status, 502);
    assert.equal(await res.text(), "not an image");
  } finally {
    delete process.env.PROXY_TOKEN;
    await upstream.close();
  }
});

test("returns 502 when upstream returns HTTP error", async () => {
  const upstream = await createMockServer();
  process.env.PROXY_TOKEN = "test-token";

  try {
    const url = `${upstream.baseUrl}/upstream-404`;
    const res = await mod.fetch(
      new Request(`http://localhost/?token=test-token&url=${encodeURIComponent(url)}`)
    );

    assert.equal(res.status, 502);
    assert.equal(await res.text(), "upstream 404");
  } finally {
    delete process.env.PROXY_TOKEN;
    await upstream.close();
  }
});
