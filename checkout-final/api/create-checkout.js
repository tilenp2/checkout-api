const { Shopify } = require('@shopify/shopify-api');

export default async function handler(req, res) {
  // CORS Headers to allow requests from your stores
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!process.env.MASTER_STORE_DOMAIN || !process.env.ADMIN_API_ACCESS_TOKEN) {
      console.error("CRITICAL: Missing environment variables!");
      return res.status(500).json({ error: "Server configuration error." });
  }

  try {
    const client = new Shopify.Clients.Graphql({
      session: {
        shop: process.env.MASTER_STORE_DOMAIN,
        accessToken: process.env.ADMIN_API_ACCESS_TOKEN,
      },
    });

    const { items } = req.body;
    const lineItems = items.map(item => ({
      title: item.title,
      originalUnitPrice: item.price,
      quantity: item.quantity,
      requiresShipping: true,
    }));
    
    const result = await client.query({
      data: {
        query: `
          mutation draftOrderCreate($input: DraftOrderInput!) {
            draftOrderCreate(input: $input) {
              draftOrder { invoiceUrl }
              userErrors { field message }
            }
          }
        `,
        variables: { input: { lineItems } },
      },
    });

    const data = result.body.data.draftOrderCreate;
    if (data.draftOrder?.invoiceUrl) {
      return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });
    } else {
      console.error("Shopify API Error:", data.userErrors);
      return res.status(500).json({ error: 'Could not create checkout from Shopify.', details: data.userErrors });
    }

  } catch (error) {
    console.error("A critical server error occurred:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}