// FINAL CORRECTED CODE - v4.4
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
    
    // STEP 1: First, ensure the product has proper options configured
    console.log('Checking product configuration...');
    const productResponse = await fetch(`${shopifyRestEndpoint}/products/${TEMPLATE_PRODUCT_ID}.json`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
      },
    });
    
    const productData = await productResponse.json();
    console.log('Current product options:', JSON.stringify(productData.product?.options, null, 2));
    
    // Check if product needs option configuration
    const hasProperOptions = productData.product?.options?.some(opt => opt.name !== 'Title');
    
    if (!hasProperOptions) {
      console.log('Product needs option configuration. Updating product...');
      
      // Update product to have a custom option
      const updateResponse = await fetch(`${shopifyRestEndpoint}/products/${TEMPLATE_PRODUCT_ID}.json`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          product: {
            id: parseInt(TEMPLATE_PRODUCT_ID),
            options: [
              {
                name: 'Style',
                values: ['Default']
              }
            ]
          }
        }),
      });
      
      const updateResult = await updateResponse.json();
      console.log('Product update result:', JSON.stringify(updateResult, null, 2));
      
      if (!updateResponse.ok) {
        throw new Error('Failed to configure product options');
      }
    }
    
    // STEP 2: Create variants using REST API
    const variantCreationPromises = items.map(async (item, index) => {
      // Generate a truly unique variant title
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const uniqueVariantTitle = `${item.title.substring(0, 50)}-${timestamp}-${random}`;
      
      const variantData = {
        variant: {
          product_id: parseInt(TEMPLATE_PRODUCT_ID),
          option1: uniqueVariantTitle, // This is the key - use option1 instead of title
          price: item.price.toString(),
          inventory_policy: 'deny',
          inventory_management: null,
          requires_shipping: true,
        }
      };
      
      console.log(`Creating variant ${index}:`, JSON.stringify(variantData, null, 2));
      
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
        console.error(`Failed to create variant ${index}. Status: ${response.status}. Shopify Response:`, JSON.stringify(result, null, 2));
        const errorMessage = result.errors?.base ? result.errors.base.join(', ') : JSON.stringify(result.errors || 'Unknown error');
        throw new Error(`Failed to create variant: ${errorMessage}`);
      }
      
      console.log(`Successfully created variant ${index}:`, result.variant.id);
      
      return {
        variantId: `gid://shopify/ProductVariant/${result.variant.id}`,
        quantity: item.quantity
      };
    });
    
    const lineItems = await Promise.all(variantCreationPromises);
    console.log('Created variants:', JSON.stringify(lineItems, null, 2));
    
    // STEP 3: Create draft order using GraphQL
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
    console.error("Full error stack:", error.stack);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
