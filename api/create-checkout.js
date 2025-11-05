// FINAL DEBUGGING VERSION - Captures Raw Shopify Response

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Access-Token');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method Not Allowed' }); }

  const { MASTER_STORE_DOMAIN, ADMIN_API_ACCESS_TOKEN, TEMPLATE_PRODUCT_ID } = process.env;

  if (!MASTER_STORE_DOMAIN || !ADMIN_API_ACCESS_TOKEN || !TEMPLATE_PRODUCT_ID) {
      console.error("CRITICAL: Missing environment variables!");
      return res.status(500).json({ error: "Server configuration error." });
  }

  const shopifyGraphQLEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-04/graphql.json`;

  try {
    const { items, currency } = req.body;

    // --- MODIFIED SECTION WITH DEBUGGING ---
    const variantCreationPromises = items.map(async (item, index) => {
      const variantInput = {
        productId: `gid://shopify/Product/${TEMPLATE_PRODUCT_ID}`,
        price: item.price,
        title: item.title.replace(item.product_title || item.title, '').trim() || 'Standard',
        imageSrc: item.image,
        inventoryPolicy: 'DENY',
      };
      const mutation = `mutation productVariantCreate($input: ProductVariantInput!) {
        productVariantCreate(input: $input) {
          productVariant { id }
          userErrors { field message }
        }
      }`;

      // 1. Make the request
      const response = await fetch(shopifyGraphQLEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
        body: JSON.stringify({ query: mutation, variables: { input: variantInput } }),
      });
      
      // 2. Capture the raw response text BEFORE trying to parse it
      const responseText = await response.text();
      console.log(`RAW SHOPIFY RESPONSE (Item ${index}):`, responseText);

      // 3. Check if the request was successful
      if (!response.ok) {
        throw new Error(`Shopify API responded with an error for item ${index}. Status: ${response.status}. Body: ${responseText}`);
      }
      
      // 4. If it was successful, parse the text and return it
      return JSON.parse(responseText);
    });
    // --- END OF MODIFIED SECTION ---

    const variantResults = await Promise.all(variantCreationPromises);

    const lineItems = variantResults.map((result, index) => {
      const variant = result.data?.productVariantCreate?.productVariant;
      if (!variant?.id) {
        console.error("Could not find a variant ID in the parsed response. UserErrors:", result.data?.productVariantCreate?.userErrors);
        throw new Error('A product variant could not be created.');
      }
      return { variantId: variant.id, quantity: items[index].quantity };
    });
    
    // ... The rest of the draft order creation logic remains the same ...
    const draftOrderMutation = `mutation draftOrderCreate($input: DraftOrderInput!) { /* ... */ }`;
    const draftOrderResponse = await fetch(shopifyGraphQLEndpoint, { /* ... */ });
    const draftOrderResult = await draftOrderResponse.json();
    const data = draftOrderResult.data?.draftOrderCreate;
    if (data?.draftOrder?.invoiceUrl) {
      return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });
    } else {
      throw new Error('Could not create the final draft order.');
    }

  } catch (error) {
    console.error("A critical server error occurred:", error.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
