import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

export default async function handler(request) {
  // Health check
  if (request.method === "GET") {
    return jsonResponse(200, {
      status: "online",
      service: "ImageTools Pro Backend"
    });
  }

  // Paddle webhooks must use POST
  if (request.method !== "POST") {
    return jsonResponse(405, {
      error: "Method not allowed"
    });
  }

  try {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;

    if (!secret) {
      console.error("PADDLE_WEBHOOK_SECRET is missing");

      return jsonResponse(500, {
        error: "Server configuration error"
      });
    }

    const signature =
      request.headers.get("paddle-signature");

    if (!signature) {
      return jsonResponse(400, {
        error: "Missing Paddle signature"
      });
    }

    // Keep the exact raw request body for Paddle signature verification.
    const rawBody = await request.text();

    const parts = signature.split(";");
    const timestampPart = parts.find((part) =>
      part.startsWith("ts=")
    );
    const hashPart = parts.find((part) =>
      part.startsWith("h1=")
    );

    if (!timestampPart || !hashPart) {
      return jsonResponse(400, {
        error: "Invalid Paddle signature"
      });
    }

    const timestamp = timestampPart.substring(3);
    const receivedHash = hashPart.substring(3);

    // Reject old webhook requests.
    const age = Math.abs(
      Date.now() / 1000 - Number(timestamp)
    );

    if (!Number.isFinite(age) || age > 5) {
      return jsonResponse(401, {
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
      return jsonResponse(401, {
        error: "Invalid webhook signature"
      });
    }

    const data = JSON.parse(rawBody);

    // Netlify automatically provides the Blobs credentials
    // when getStore() runs inside a Netlify Function.
    const store = getStore("paddle-events");

    const eventId =
      data.event_id || `event-${Date.now()}`;

    await store.setJSON(eventId, {
      receivedAt: new Date().toISOString(),
      eventType: data.event_type || null,
      eventId,
      data: data.data || null
    });

    console.log(
      "Verified Paddle webhook:",
      eventId,
      data.event_type
    );

    return jsonResponse(200, {
      success: true
    });
  } catch (error) {
    console.error("Webhook processing error:", error);

    return jsonResponse(500, {
      error: "Webhook processing failed"
    });
  }
}
