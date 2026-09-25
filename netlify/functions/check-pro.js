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
  if (request.method !== "POST") {
    return jsonResponse(405, {
      error: "Method not allowed"
    });
  }

  try {
    const { subscriptionId } = await request.json();

    if (!subscriptionId) {
      return jsonResponse(400, {
        error: "Missing subscriptionId"
      });
    }

    const store = getStore("paddle-events");

    const { blobs } = await store.list();

    for (const blob of blobs) {
      const event = await store.get(blob.key, {
        type: "json"
      });

      if (
        event?.data?.id === subscriptionId &&
        event?.data?.status
      ) {
        const status = event.data.status;

        return jsonResponse(200, {
          isPro:
            status === "active" ||
            status === "trialing",
          status,
          subscriptionId
        });
      }
    }

    return jsonResponse(404, {
      isPro: false,
      status: "not_found"
    });

  } catch (error) {
    console.error("Pro status check error:", error);

    return jsonResponse(500, {
      error: "Pro status check failed"
    });
  }
}
