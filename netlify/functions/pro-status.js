import { createHmac, timingSafeEqual } from "crypto";
import { getStore } from "@netlify/blobs";

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

export async function handler(event) {
  // Simple health check
  if (event.httpMethod === "GET") {
    return response(200, {
      status: "online",
      service: "ImageTools Pro Backend"
    });
  }

  // Paddle webhooks must use POST
  if (event.httpMethod !== "POST") {
    return response(405, {
      error: "Method not allowed"
    });
  }

  try {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;

    if (!secret) {
      console.error("PADDLE_WEBHOOK_SECRET is missing");
      return response(500, {
        error: "Server configuration error"
      });
    }

    const signature =
      event.headers["paddle-signature"] ||
      event.headers["Paddle-Signature"];

    if (!signature) {
      return response(400, {
        error: "Missing Paddle signature"
      });
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body || "";

    const parts = signature.split(";");
    const timestampPart = parts.find((part) => part.startsWith("ts="));
    const hashPart = parts.find((part) => part.startsWith("h1="));

    if (!timestampPart || !hashPart) {
      return response(400, {
        error: "Invalid Paddle signature"
      });
    }

    const timestamp = timestampPart.substring(3);
    const receivedHash = hashPart.substring(3);

    // Reject old webhook requests to help prevent replay attacks.
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));

    if (!Number.isFinite(age) || age > 5) {
      return response(401, {
        error: "Expired webhook"
      });
    }

    const signedPayload = `${timestamp}:${rawBody}`;

    const expectedHash = createHmac("sha256", secret)
      .update(signedPayload, "utf8")
      .digest("hex");

    const receivedBuffer = Buffer.from(receivedHash, "utf8");
    const expectedBuffer = Buffer.from(expectedHash, "utf8");

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      return response(401, {
        error: "Invalid webhook signature"
      });
    }

    const data = JSON.parse(rawBody);

    const store = getStore("paddle-events");

    const eventId = data.event_id || `event-${Date.now()}`;

    await store.setJSON(eventId, {
      receivedAt: new Date().toISOString(),
      eventType: data.event_type || null,
      eventId,
      data: data.data || null
    });

    console.log("Verified Paddle webhook:", eventId, data.event_type);

    return response(200, {
      success: true
    });
  } catch (error) {
    console.error("Webhook processing error:", error);

    return response(500, {
      error: "Webhook processing failed"
    });
  }
}
