// Vercel Serverless Function: api/create-checkout.js
import { Shopify } from '@shopify/shopify-api';

const client = new Shopify.Clients.Graphql({
  session: {
    shop: process.env.MASTER_STORE_DOMAIN,
    accessToken: process.env.ADMIN_API_ACCESS_TOKEN,
  },
});

const CREATE_DRAFT_ORDER_MUTATION = `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { invoiceUrl }
      userErrors { field message }
    }
  }
`;

export default async function handler(req, res) {
  // --- THIS IS THE FIX ---
  // We are adding these headers to tell the browser who is on the "guest list".
  
  // This says "allow requests from any domain". For testing, this is fine.
  // For production, you could replace '*' with 'https://trygina.shop'
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // This tells the browser what kind of methods are allowed.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  // This tells the browser what headers are allowed.
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // The browser sends a "preflight" OPTIONS request first to ask for permission.
  // We need to handle that request and send back an "OK".
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  // --- END OF FIX ---


  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { items } = req.body;
    const lineItems = items.map(item => ({
      title: item.title,
      originalUnitPrice: item.price,
      quantity: item.quantity,
      requiresShipping: true,
    }));

    const result = await client.query({
      data: {
        query: CREATE_DRAFT_ORDER_MUTATION,
        variables: { input: { lineItems } },
      },
    });

    const data = result.body.data.draftOrderCreate;
    if (data.draftOrder?.invoiceUrl) {
      return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });
    } else {
      console.error("Draft order error:", data.userErrors);
      return res.status(500).json({ error: 'Failed to create checkout', details: data.userErrors });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
}
