
const crypto = require("crypto");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("LINE Webhook Ready");
  }

  const GAS_URL = process.env.GAS_WEB_APP_URL;
  const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;

  if (!GAS_URL || !LINE_SECRET) {
    console.error("Missing environment variables");
    return res.status(500).send("Configuration missing");
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["x-line-signature"];

    if (!verifySignature(rawBody, signature, LINE_SECRET)) {
      return res.status(401).send("Invalid signature");
    }

    const payload = JSON.parse(rawBody.toString("utf8"));

    if (!Array.isArray(payload.events)) {
      return res.status(400).send("Invalid LINE event payload");
    }

    // ส่งข้อมูล LINE ไปยัง Apps Script
    const upstream = await fetch(GAS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: rawBody,
      redirect: "follow"
    });

    if (!upstream.ok) {
      console.error("Apps Script HTTP:", upstream.status);
      return res.status(502).send("Apps Script error");
    }

    return res.status(200).send("OK");

  } catch (error) {
    console.error("LINE Webhook Error:", error.message);
    return res.status(500).send("Internal Server Error");
  }
}

module.exports = handler;

module.exports.config = {
  api: {
    bodyParser: false
  }
};
