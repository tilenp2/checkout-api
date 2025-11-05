// ULTIMATE DEBUGGING VERSION - Logs every step

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Access-Token');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method Not Allowed' }); }

  console.log("--- New Checkout Request Received ---");

  const { MASTER_STORE_DOMAIN, ADMIN_API_ACCESS_TOKEN, TEMPLATE_PRODUCT_ID } = process.env;

  if (!MASTER_STORE_DOMAIN || !ADMIN_API_ACCESS_TOKEN || !TEMPLATE_PRODUCT_ID) {
    console.error("CRITICAL: Missing one or more environment variables!");
    console.log(`MASTER_STORE_DOMAIN exists: ${!!MASTER_STORE_DOMAIN}`);
    console.log(`ADMIN_API_ACCESS_TOKEN exists: ${!!ADMIN_API_ACCESS_TOKEN}`);
    console.log(`TEMPLATE_PRODUCT_ID exists: ${!!TEMPLATE_PRODUCT_ID}`);
    return res.status(500).json({ error: "Server configuration error." });
  }

  const shopifyGraphQLEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-04/graphql.json`;
  console.log("Using Shopify Endpoint:", shopifyGraphQLEndpoint);

  try {
    const { items, currency } = req.body;
    console.log("Received payload:", { items, currency });

    // --- STEP 1: CREATE VARIANTS ---
    console.log("Attempting to create variants...");
    const variantCreationPromises = items.map(async (item, index) => {
      const variantInput = {
        productId: `gid://shopify/Product/${TEMPLATE_PRODUCT_ID}`,
        price: item.price,
        title: item.title.replace(item.product_title || item.title, '').trim() || 'Standard',
        imageSrc: item.image,
        inventoryPolicy: 'DENY',
      };
      console.log(`Constructed variantInput for item ${index}:`, variantInput);

      const mutation = `mutation productVariantCreate($input: ProductVariantInput!) {
        productVariantCreate(input: $input) { productVariant { id } userErrors { field message } }
      }`;
      
      const response = await fetch(shopifyGraphQLEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
        body: JSON.stringify({ query: mutation, variables: { input: variantInput } }),
      });

      const responseText = await response.text();
      console.log(`RAW SHOPIFY VARIANT RESPONSE (Item ${index}):`, responseText);

      if (!response.ok) {
        throw new Error(`Shopify API responded with an error for item ${index}. Status: ${response.status}. Body: ${responseText}`);
      }
      return JSON.parse(responseText);
    });

    const variantResults = await Promise.all(variantCreationPromises);

    const lineItems = variantResults.map((result, index) => {
      const variant = result.data?.productVariantCreate?.productVariant;
      if (!variant?.id) {
        throw new Error('Failed to get a valid variant ID from Shopify response.');
      }
      return { variantId: variant.id, quantity: items[index].quantity };
    });
    console.log("Successfully created variants. Line items for draft order:", lineItems);

    // --- STEP 2: CREATE DRAFT ORDER ---
    console.log("Attempting to create draft order...");
    // ... [Draft order creation logic] ...
    const draftOrderMutation = `mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) { draftOrder { invoiceUrl } userErrors { field message } }
    }`;
    const draftOrderResponse = await fetch(shopifyGraphQLEndpoint, { /* ... */ });
    const draftOrderResult = await draftOrderResponse.json();
    const data = draftOrderResult.data?.draftOrderCreate;

    if (data?.draftOrder?.invoiceUrl) {
      console.log("--- Successfully created checkout URL ---");
      return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });
    } else {
      throw new Error('Could not create the final draft order.');
    }

  } catch (error) {
    console.error("--- A critical server error occurred ---", error.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
