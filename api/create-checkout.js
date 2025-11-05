// FINAL - Variant Creation Method (to support images)
const { Shopify } = require('@shopify/shopify-api');

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method Not Allowed' }); }

  if (!process.env.MASTER_STORE_DOMAIN || !process.env.ADMIN_API_ACCESS_TOKEN || !process.env.TEMPLATE_PRODUCT_ID) {
      console.error("CRITICAL: Missing environment variables!");
      return res.status(500).json({ error: "Server configuration error." });
  }

  const client = new Shopify.Clients.Graphql({
    session: {
      shop: process.env.MASTER_STORE_DOMAIN,
      accessToken: process.env.ADMIN_API_ACCESS_TOKEN,
    },
  });

  try {
    const { items, currency } = req.body;

    // Create a new variant for EACH item in the cart
    const variantPromises = items.map(item => {
      const variantInput = {
        productId: `gid://shopify/Product/${process.env.TEMPLATE_PRODUCT_ID}`,
        price: item.price,
        title: item.title.replace(item.product_title, '').trim() || 'Standard', // Use variant title
        imageSrc: item.image,
        inventoryPolicy: 'DENY',
      };
      return client.query({
        data: {
          query: `mutation productVariantCreate($input: ProductVariantInput!) {
            productVariantCreate(input: $input) {
              productVariant { id }
              userErrors { field message }
            }
          }`,
          variables: { input: variantInput },
        },
      });
    });

    const results = await Promise.all(variantPromises);
    const lineItems = [];
    for (const [index, result] of results.entries()) {
      const variant = result.body.data.productVariantCreate.productVariant;
      if (variant?.id) {
        lineItems.push({
          variantId: variant.id,
          quantity: items[index].quantity,
        });
      }
    }

    // Now, create a draft order using these newly created variant IDs
    const draftOrderResult = await client.query({
      data: {
        query: `mutation draftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder { invoiceUrl }
            userErrors { field message }
          }
        }`,
        variables: { input: { lineItems, currencyCode: currency } },
      },
    });
    
    const data = draftOrderResult.body.data.draftOrderCreate;
    if (data.draftOrder?.invoiceUrl) {
      return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });
    } else {
      throw new Error(JSON.stringify(data.userErrors));
    }

  } catch (error) {
    console.error("A critical server error occurred:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
