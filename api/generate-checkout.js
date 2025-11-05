// FINAL WORKING CODE - Simple Draft Order Method

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Access-Token');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method Not Allowed' }); }

  const { MASTER_STORE_DOMAIN, ADMIN_API_ACCESS_TOKEN } = process.env;

  if (!MASTER_STORE_DOMAIN || !ADMIN_API_ACCESS_TOKEN) {
      console.error("CRITICAL: Missing MASTER_STORE_DOMAIN or ADMIN_API_ACCESS_TOKEN");
      return res.status(500).json({ error: "Server configuration error." });
  }

  const shopifyGraphQLEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-04/graphql.json`;

  try {
    const { items, currency } = req.body;

    const lineItems = items.map(item => ({
      title: item.title,
      originalUnitPrice: item.price,
      quantity: item.quantity,
      requiresShipping: true,
    }));

    const draftOrderMutation = `
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { invoiceUrl }
          userErrors { field message }
        }
      }
    `;

    const response = await fetch(shopifyGraphQLEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        query: draftOrderMutation,
        variables: { input: { lineItems, currencyCode: currency } },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Shopify API responded with status ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const data = result.data.draftOrderCreate;

    if (data.draftOrder?.invoiceUrl) {
      return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });
    } else {
      console.error("Shopify GraphQL Error:", data.userErrors);
      return res.status(500).json({ error: 'Could not create checkout from Shopify.', details: data.userErrors });
    }

  } catch (error)
 {
    console.error("A critical server error occurred:", error.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
