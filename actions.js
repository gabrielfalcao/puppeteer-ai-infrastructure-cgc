const puppeteer = require("puppeteer");

const fs = require("node:fs/promises");
const { sha256 } = require("hash.js");
const WIDTH = 2560;
const HEIGHT = 1600;

function slugify(value) {
  return value
    .toString()
    .replaceAll(/[^a-zA-Z0-9_-]+/g, "-")
    .replaceAll(/^[-]+/g, "")
    .replaceAll(/[-]+$/g, "");
}
function timestampedFilenameForUrl(
  targetUrl,
  headers,
) {
  const url = new URL(targetUrl.toString());
  let hasher = sha256().update(url.toString());
  if (headers) {
    hasher = hasher.update(JSON.stringify(headers));
  }
  const hash = hasher.digest("hex");
  const now = new Date();
  const timestamp = now.getTime();
  return slugify(`${url.origin}-${hash}-${timestamp}`);
}

async function serializeRequest(request) {
  const url = request.url();
  const requestUrl = new URL(url);

  const method = request.method();
  const headers = request.headers();
  const postData = (() => {
    const data = request.postData();
    try {
      return JSON.parse(data);
    } catch (_) {
      return data;
    }
  })();
  const data = {
    url,
    method,
    headers,
    postData,
  };
  return data;
}

async function logRequest(targetAIUrl, request) {
  const aiUrl = new URL(targetAIUrl.toString());
  const chid = aiUrl.searchParams.get("mention_id");
  const url = request.url();
  const filenamePrefix = timestampedFilenameForUrl(url, request.headers());
  console.log(`logging request for ${url}`);
  const requestDumpFilename = `logs/mention-id-${chid}-${filenamePrefix}.request.json`;
  let jsonRequest = null;
  try {
    jsonRequest = JSON.stringify(await serializeRequest(request), null, 2);
  } catch (e) {
    console.error(`error logging request for ${url}: ${e}`);
    return;
  }
  const fd = await fs.open(requestDumpFilename, "w");
  await fd.write(jsonRequest);
  await fd.close();
}

async function serializeResponse(response) {
  const url = response.url();
  const status = response.status();
  const content = await (async () => {
    try {
      return await response.content();
    } catch (e) {
      return new Uint8Array();
    }
  })();
  const headers = response.headers();
  return {
    url,
    content,
    headers,
    status,
  };
}

async function logResponse(targetAIUrl, response) {
  const headers = response.headers();
  if (!/^(application\/text)/.exec(headers["Content-Type"])) {
    return;
  }
  const aiUrl = new URL(targetAIUrl);
  const chid = aiUrl.pathname.split("/").pop();
  const url = response.url();
  const filenamePrefix = timestampedFilenameForUrl(url, headers);
  console.log(`logging response for ${url}`);
  const responseDumpFilename = `logs/${chid}-${filenamePrefix}.response.json`;
  let jsonResponse = null;
  try {
    jsonResponse = JSON.stringify(await serializeResponse(response), null, 2);
  } catch (e) {
    console.error(`error logging response for ${url}: ${e}`);
    return;
  }
  const fd = await fs.open(responseDumpFilename, "w");
  await fd.write(jsonResponse);
  await fd.close();
}
async function photo_ai_concern(url) {
  const aiUrl = new URL(url);
  const aiSlug = slugify(aiUrl.toString());
  const chid = aiUrl.pathname.split("/").pop();

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  page.on("request", async (request) => {
    await logRequest(url, request);
  });

  page.on("response", async (response) => {
    await logResponse(url, response);
  });

  await page.setViewport({ width: WIDTH, height: HEIGHT });
  await page.goto(url.toString(), {
    waitUntil: "networkidle2",
  });
  await page.screenshot({
    path: `screenshots/${aiSlug}-0.png`,
  });
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForNetworkIdle();
  await page.screenshot({
    path: `screenshots/${aiSlug}-1.png`,
  });
  await page.mouse.wheel({
    deltaY: HEIGHT,
  });
  await page.screenshot({
    path: `screenshots/${aiSlug}-2.png`,
  });
  await page.reload();
  await page.screenshot({
    path: `screenshots/${aiSlug}-3.png`,
  });

  await browser.close();
}

async function main() {
  const reviewLinks = JSON.parse(
    Array.from(await fs.readFile("./review-links.json"))
      .map((c) => String.fromCharCode(c))
      .join(""),
  );

  await fs.mkdir("logs", { recursive: true });
  await fs.mkdir("screenshots", { recursive: true });

  for (const link of reviewLinks) {
    await photo_ai_concern(link);
  }
}

main();
