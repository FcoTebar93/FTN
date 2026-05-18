import assert from "node:assert/strict";
import { test } from "node:test";
import { Buffer } from "node:buffer";

import { extractDataUrlImagesToCid, parseImageDataUrl } from "../modules/integrations/notifications/inline-html-images";

test("parseImageDataUrl acepta PNG base64", () => {
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const url = `data:image/png;base64,${png1x1}`;
  const parsed = parseImageDataUrl(url);
  assert.ok(parsed);
  assert.equal(parsed!.contentType, "image/png");
  assert.ok(parsed!.content.length > 0);
});

test("extractDataUrlImagesToCid reemplaza src y genera una parte inline", () => {
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const dataUrl = `data:image/png;base64,${png1x1}`;
  const html = `<p>x</p><img src="${dataUrl}" alt="qr" />`;
  const { html: out, inlineImages } = extractDataUrlImagesToCid(html);
  assert.equal(inlineImages.length, 1);
  assert.equal(inlineImages[0].cid, "ftn_inline_0");
  assert.match(out, /src="cid:ftn_inline_0"/);
  assert.ok(Buffer.isBuffer(inlineImages[0].content));
});

test("extractDataUrlImagesToCid admite comillas simples", () => {
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const dataUrl = `data:image/png;base64,${png1x1}`;
  const html = `<img src='${dataUrl}' />`;
  const { html: out, inlineImages } = extractDataUrlImagesToCid(html);
  assert.equal(inlineImages.length, 1);
  assert.match(out, /src='cid:ftn_inline_0'/);
});

test("extractDataUrlImagesToCid deja sin tocar URLs no data:", () => {
  const html = `<img src="https://example.com/a.png" />`;
  const { html: out, inlineImages } = extractDataUrlImagesToCid(html);
  assert.equal(inlineImages.length, 0);
  assert.equal(out, html);
});
