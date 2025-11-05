// FINAL WORKING VERSION - v1.1

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

    const variantCreationPromises = items.map(item => {
      const variantInput = {
        productId: `gid://shopify/Product/${TEMPLATE_PRODUCT_ID}`,
        price: item.price,
        title: item.title.replace(item.product_title || item.title, '').trim() || 'Standard',
        imageSrc: item.image,
        inventoryPolicy: 'DENY',
      };
      
      const mutation = `
        mutation($input: ProductVariantInput!) {
          productVariantCreate(input: $input) {
            productVariant { id }
            userErrors { field message }
          }
        }
      `;
      
      return fetch(shopifyGraphQLEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
        body: JSON.stringify({ query: mutation, variables: { input: variantInput } }),
      }).then(response => response.json());
    });

    const variantResults = await Promise.all(variantCreationPromises);

    const lineItems = variantResults.map((result, index) => {
      const variant = result.data?.productVariantCreate?.productVariant;
      if (!variant?.id) {
        console.error("Failed to create a variant:", result.data?.productVariantCreate?.userErrors);
        throw new Error('A product variant could not be created.');
      }
      return { variantId: variant.id, quantity: items[index].quantity };
    });
    
    const draftOrderMutation = `
      mutation($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { invoiceUrl }
          userErrors { field message }
        }
      }
    `;

    const draftOrderResponse = await fetch(shopifyGraphQLEndpoint, {
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
    
    const draftOrderResult = await draftOrderResponse.json();
    const data = draftOrderResult.data?.draftOrderCreate;

    if (data?.draftOrder?.invoiceUrl) {
      return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });
    } else {
      console.error("Shopify GraphQL Error:", data?.userErrors);
      throw new Error('Could not create the final draft order.');
    }

  } catch (error) {
    console.error("A critical server error occurred:", error.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
