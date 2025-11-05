// FINAL, CORRECTED Vercel Serverless Function: api/create-checkout.js

// --- THIS IS THE FIX ---
// We are switching from 'import' to 'require' for better compatibility.
const { Shopify } = require('@shopify/shopify-api');
// --- END OF FIX ---

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle actual POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Check for environment variables
  if (!process.env.MASTER_STORE_DOMAIN || !process.env.ADMIN_API_ACCESS_TOKEN) {
      console.error("Missing environment variables!");
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
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty cart items data.' });
    }

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
      console.error("Failed to create draft order:", data.userErrors);
      return res.status(500).json({ error: 'Could not create checkout from Shopify.', details: data.userErrors });
    }

  } catch (error) {
    console.error("A critical error occurred:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
