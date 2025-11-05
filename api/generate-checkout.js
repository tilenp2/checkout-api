// FINAL CORRECTED CODE - v4.5
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
    
    // STEP 1: Get current product state
    console.log('Fetching product configuration...');
    const productResponse = await fetch(`${shopifyRestEndpoint}/products/${TEMPLATE_PRODUCT_ID}.json`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
      },
    });
    
    if (!productResponse.ok) {
      throw new Error('Failed to fetch product');
    }
    
    const productData = await productResponse.json();
    console.log('Current product state:', JSON.stringify({
      options: productData.product?.options,
      variants: productData.product?.variants?.length
    }, null, 2));
    
    // STEP 2: Ensure product has proper variant structure
    const currentOptions = productData.product?.options || [];
    const hasDefaultTitleOnly = currentOptions.length === 1 && currentOptions[0].name === 'Title';
    const hasNoOptions = currentOptions.length === 0;
    
    if (hasDefaultTitleOnly || hasNoOptions) {
      console.log('Product needs proper variant structure. Updating...');
      
      // Get the existing variant ID if it exists (to preserve it)
      const existingVariantId = productData.product?.variants?.[0]?.id;
      
      const productUpdatePayload = {
        product: {
          id: parseInt(TEMPLATE_PRODUCT_ID),
          options: [
            {
              name: 'Item',
              position: 1
            }
          ]
        }
      };
      
      // If there's an existing variant, update it to use the new option
      if (existingVariantId) {
        productUpdatePayload.product.variants = [
          {
            id: existingVariantId,
            option1: 'Default'
          }
        ];
      }
      
      const updateResponse = await fetch(`${shopifyRestEndpoint}/products/${TEMPLATE_PRODUCT_ID}.json`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
        body: JSON.stringify(productUpdatePayload),
      });
      
      const updateResult = await updateResponse.json();
      console.log('Product structure update result:', JSON.stringify(updateResult, null, 2));
      
      if (!updateResponse.ok) {
        console.error('Failed to update product structure:', JSON.stringify(updateResult, null, 2));
        throw new Error('Failed to configure product for variants');
      }
      
      // Wait a moment for Shopify to process the update
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // STEP 3: Create variants for each cart item
    const variantCreationPromises = items.map(async (item, index) => {
      // Generate unique option value
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const uniqueOption = `${item.title.substring(0, 40)}-${timestamp}-${random}`;
      
      const variantData = {
        variant: {
          option1: uniqueOption,
          price: item.price.toString(),
          inventory_policy: 'deny',
          inventory_management: null,
          requires_shipping: true,
          taxable: true
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
        console.error(`Failed to create variant ${index}. Status: ${response.status}`);
        console.error('Full response:', JSON.stringify(result, null, 2));
        
        const errorMessage = result.errors?.base 
          ? result.errors.base.join(', ') 
          : result.errors 
            ? JSON.stringify(result.errors) 
            : 'Unknown error';
        
        throw new Error(`Failed to create variant: ${errorMessage}`);
      }
      
      console.log(`Successfully created variant ${index}: ID ${result.variant.id}`);
      
      return {
        variantId: `gid://shopify/ProductVariant/${result.variant.id}`,
        quantity: item.quantity
      };
    });
    
    const lineItems = await Promise.all(variantCreationPromises);
    console.log('All variants created successfully:', JSON.stringify(lineItems, null, 2));
    
    // STEP 4: Create draft order using GraphQL
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
    
    console.log('Creating draft order with line items:', JSON.stringify(lineItems, null, 2));
    
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
      console.error("Draft order user errors:", data.userErrors);
      throw new Error(`Shopify validation error: ${data.userErrors[0].message}`);
    }
    
    if (data?.draftOrder?.invoiceUrl) {
      console.log('SUCCESS! Checkout URL generated:', data.draftOrder.invoiceUrl);
      return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });
    } else {
      console.error("No invoice URL in response:", JSON.stringify(draftOrderResult, null, 2));
      throw new Error('Could not create the draft order checkout URL.');
    }
    
  } catch (error) {
    console.error("=== CRITICAL ERROR ===");
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
    return res.status(500).json({ 
      error: error.message || 'Internal Server Error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
