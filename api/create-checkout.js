// Vercel Serverless Function: api/create-checkout.js

import { Shopify } from '@shopify/shopify-api';

// --- CONFIGURATION (Store in Vercel Environment Variables) ---
const MASTER_STORE_DOMAIN = process.env.MASTER_STORE_DOMAIN;
const ADMIN_API_ACCESS_TOKEN = process.env.ADMIN_API_ACCESS_TOKEN;

const client = new Shopify.Clients.Graphql({
  session: {
    shop: MASTER_STORE_DOMAIN,
    accessToken: ADMIN_API_ACCESS_TOKEN,
  },
});

// The GraphQL mutation to create a draft order with custom line items
const CREATE_DRAFT_ORDER_MUTATION = `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        invoiceUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export default async function handler(request, response) {
  // CORS and Method checks
  if (request.method === 'OPTIONS') { return response.status(200).end(); }
  response.setHeader('Access-Control-Allow-Origin', '*'); // Or specific domains
  response.setHeader('Access-Control-Allow-Methods', 'POST');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method !== 'POST') { return response.status(405).json({ error: 'Method Not Allowed' }); }

  try {
    const { items } = request.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return response.status(400).json({ error: 'Invalid cart items data.' });
    }

    // Transform the cart items into the format Shopify needs for the Draft Order API
    const lineItems = items.map(item => ({
      title: item.title,
      // The price of a single unit. Shopify will multiply by quantity.
      originalUnitPrice: item.price, 
      quantity: item.quantity,
      requiresShipping: true, 
      taxable: true, 
    }));

    const draftOrderInput = {
      lineItems: lineItems,
    };

    // Make the single API call to create the draft order
    const res = await client.query({
      data: {
        query: CREATE_DRAFT_ORDER_MUTATION,
        variables: { input: draftOrderInput },
      },
    });

    const draftOrderData = res.body.data.draftOrderCreate;

    if (draftOrderData.draftOrder && draftOrderData.draftOrder.invoiceUrl) {
      // SUCCESS! Send the checkout URL back to the frontend.
      return response.status(200).json({ checkoutUrl: draftOrderData.draftOrder.invoiceUrl });
    } else {
      console.error("Failed to create draft order:", draftOrderData.userErrors);
      return response.status(500).json({ error: 'Could not create checkout.', details: draftOrderData.userErrors });
    }

  } catch (error) {
    console.error('Error processing draft order:', error);
    return response.status(500).json({ error: 'Internal Server Error' });
  }
}