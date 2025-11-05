// FINAL ROBUST VERSION - v3.0

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Access-Token');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method Not Allowed' }); }

  const { MASTER_STORE_DOMAIN, ADMIN_API_ACCESS_TOKEN, TEMPLATE_PRODUCT_ID } = process.env;

  if (!MASTER_STORE_DOMAIN || !ADMIN_API_ACCESS_TOKEN || !TEMPLATE_PRODUCT_ID) {
      console.error("CRITICAL: Missing one or more environment variables!");
      return res.status(500).json({ error: "Server configuration error." });
  }

  const shopifyGraphQLEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-04/graphql.json`;

  try {
    const { items, currency } = req.body;
    console.log("--- New Request ---");
    console.log("Received payload with item count:", items.length);

    // --- STEP 1: CREATE VARIANTS ---
    const variantCreationPromises = items.map((item, index) => {
      // Defensive coding: Ensure a unique variant title to prevent Shopify errors.
      // We combine the original title with a timestamp and index.
      const uniqueVariantTitle = (item.title.replace(item.product_title || item.title, '').trim() || `Item ${index + 1}`) + `-${Date.now()}`;
      
      const variantInput = {
        productId: `gid://shopify/Product/${TEMPLATE_PRODUCT_ID}`,
        price: item.price,
        title: uniqueVariantTitle,
        imageSrc: item.image,
        inventoryPolicy: 'DENY',
      };
      
      const mutation = `
        mutation productVariantCreate($input: ProductVariantInput!) {
          productVariantCreate(input: $input) {
            productVariant { id }
            userErrors { field message }
          }
        }
      `;
      
      console.log(`Preparing to create variant ${index}:`, { price: variantInput.price, title: variantInput.title });
      
      return fetch(shopifyGraphQLEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
        body: JSON.stringify({ query: mutation, variables: { input: variantInput } }),
      }).then(response => {
          if (!response.ok) {
              return response.text().then(text => { 
                  throw new Error(`Shopify API Error (Variant Create): Status ${response.status} - ${text}`);
              });
          }
          return response.json();
      });
    });

    const variantResults = await Promise.all(variantCreationPromises);

    const lineItems = variantResults.map((result, index) => {
      const variant = result.data?.productVariantCreate?.productVariant;
      if (!variant?.id) {
        console.error(`Failed to create variant ${index}. Shopify Response:`, JSON.stringify(result, null, 2));
        throw new Error('A product variant could not be created. Check the server logs for details.');
      }
      console.log(`Successfully created variant ${index}: ${variant.id}`);
      return { variantId: variant.id, quantity: items[index].quantity };
    });
    
    // --- STEP 2: CREATE DRAFT ORDER ---
    const draftOrderMutation = `
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { invoiceUrl }
          userErrors { field message }
        }
      }
    `;

    const draftOrderResponse = await fetch(shopifyGraphQLEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN, },
      body: JSON.stringify({ query: draftOrderMutation, variables: { input: { lineItems, currencyCode: currency } }, }),
    });

    if (!draftOrderResponse.ok) {
        const text = await draftOrderResponse.text();
        throw new Error(`Shopify API Error (Draft Order Create): Status ${draftOrderResponse.status} - ${text}`);
    }

    const draftOrderResult = await draftOrderResponse.json();
    const data = draftOrderResult.data?.draftOrderCreate;

    if (data?.draftOrder?.invoiceUrl) {
      console.log("--- Success! ---");
      return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });
    } else {
      console.error("Failed to create draft order. Shopify Response:", JSON.stringify(draftOrderResult, null, 2));
      throw new Error('Could not create the final draft order. Check server logs.');
    }

  } catch (error) {
    console.error("--- A critical server error occurred ---", error.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
