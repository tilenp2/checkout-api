// FINAL CORRECTED CODE - v4.2
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
  
  const shopifyRestEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-10`;
  const shopifyGraphQLEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-10/graphql.json`;
  
  try {
    const { items, currency } = req.body;
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    // Create variants using REST API (more reliable for individual variants)
    const variantCreationPromises = items.map(async (item, index) => {
      const uniqueVariantTitle = (item.title.replace(item.product_title || item.title, '').trim() || `Item ${index + 1}`) + `-${Date.now()}-${index}`;
      
      const variantData = {
        variant: {
          product_id: TEMPLATE_PRODUCT_ID,
          title: uniqueVariantTitle,
          price: item.price,
          inventory_policy: 'deny',
          inventory_management: null,
        }
      };
      
      // Add image if exists
      if (item.image) {
        variantData.variant.image_src = item.image;
      }
      
      const response = await fetch(`${shopifyRestEndpoint}/products/${TEMPLATE_PRODUCT_ID}/variants.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
        body: JSON.stringify(variantData),
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.variant?.id) {
        console.error(`Failed to create variant ${index}. Shopify Response:`, JSON.stringify(result, null, 2));
        throw new Error(`Failed to create variant: ${result.errors || 'Unknown error'}`);
      }
      
      return {
        variantId: `gid://shopify/ProductVariant/${result.variant.id}`,
        quantity: item.quantity
      };
    });
    
    const lineItems = await Promise.all(variantCreationPromises);
    console.log('Created variants:', JSON.stringify(lineItems, null, 2));
    
    // Create draft order using GraphQL
    const draftOrderMutation = `
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
    
    const draftOrderResponse = await fetch(shopifyGraphQLEndpoint, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN, 
      },
      body: JSON.stringify({ 
        query: draftOrderMutation, 
        variables: { 
          input: { 
            lineItems: lineItems,
            presentmentCurrencyCode: currency 
          } 
        }, 
      }),
    });
    
    const draftOrderResult = await draftOrderResponse.json();
    console.log('Draft order result:', JSON.stringify(draftOrderResult, null, 2));
    
    const data = draftOrderResult.data?.draftOrderCreate;
    
    if (data?.userErrors && data.userErrors.length > 0) {
      console.error("Draft order user errors:", JSON.stringify(data.userErrors, null, 2));
      throw new Error(`Shopify validation error: ${data.userErrors[0].message}`);
    }
    
    if (data?.draftOrder?.invoiceUrl) {
      return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });
    } else {
      console.error("Failed to create draft order. Shopify Response:", JSON.stringify(draftOrderResult, null, 2));
      throw new Error('Could not create the final draft order. Check server logs.');
    }
  } catch (error) {
    console.error("--- A critical server error occurred ---", error.message);
    console.error("Full error:", error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
