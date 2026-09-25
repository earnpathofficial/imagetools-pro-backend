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
    const body = await request.json();

    const customerId = body.customerId;
    const subscriptionId = body.subscriptionId;

    if (!customerId && !subscriptionId) {
      return jsonResponse(400, {
        error: "Missing customerId or subscriptionId"
      });
    }

    const store = getStore("paddle-events");

    const { blobs } = await store.list();

    for (const blob of blobs) {
      const event = await store.get(blob.key, {
        type: "json"
      });

      const data = event?.data;

      if (!data) {
        continue;
      }

      const matchesSubscription =
        subscriptionId &&
        data.id === subscriptionId;

      const matchesCustomer =
        customerId &&
        data.custom_data?.imagetools_customer_id === customerId;

      if (matchesSubscription || matchesCustomer) {
        const status = data.status || null;

        return jsonResponse(200, {
          isPro:
            status === "active" ||
            status === "trialing",
          status,
          subscriptionId: data.id || null,
          customerId:
            data.custom_data?.imagetools_customer_id || null
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
