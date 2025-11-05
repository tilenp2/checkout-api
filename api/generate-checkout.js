// SIMPLIFIED CODE - v5.1 - Create Products from Scratch (Any Currency)
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Access-Token');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method Not Allowed' }); }
  
  const { MASTER_STORE_DOMAIN, ADMIN_API_ACCESS_TOKEN } = process.env;
  if (!MASTER_STORE_DOMAIN || !ADMIN_API_ACCESS_TOKEN) {
      console.error("CRITICAL: Missing environment variables!");
      return res.status(500).json({ error: "Server configuration error." });
  }
  
  const shopifyRestEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-10`;
  const shopifyGraphQLEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-10/graphql.json`;
  
  try {
    const { items, currency } = req.body;
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log(`Creating ${items.length} new product(s)...`);
    
    // STEP 1: Create a product for each unique item
    const productCreationPromises = items.map(async (item, index) => {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      
      const productData = {
        product: {
          title: item.title,
          body_html: item.description || `Product: ${item.title}`,
          vendor: "Dynamic Cart",
          product_type: "Cart Item",
          status: "active",
          published: false, // Keep unpublished so it doesn't show in store
          variants: [
            {
              price: item.price.toString(),
              inventory_policy: 'deny',
              inventory_management: null,
              requires_shipping: true,
              sku: `CART-${timestamp}-${random}`
            }
          ],
          options: [
            {
              name: "Title",
              values: ["Default Title"]
            }
          ]
        }
      };
      
      // Add image if provided
      if (item.image) {
        productData.product.images = [
          {
            src: item.image,
            position: 1
          }
        ];
      }
      
      console.log(`Creating product ${index + 1}:`, JSON.stringify({
        title: productData.product.title,
        price: productData.product.variants[0].price,
        hasImage: !!item.image
      }, null, 2));
      
      const response = await fetch(`${shopifyRestEndpoint}/products.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
        body: JSON.stringify(productData),
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.product?.id) {
        console.error(`Failed to create product ${index + 1}:`, JSON.stringify(result, null, 2));
        throw new Error(`Failed to create product: ${JSON.stringify(result.errors)}`);
      }
      
      const variantId = result.product.variants[0].id;
      console.log(`Successfully created product ${index + 1}: Product ID ${result.product.id}, Variant ID ${variantId}`);
      
      return {
        productId: result.product.id,
        variantId: `gid://shopify/ProductVariant/${variantId}`,
        quantity: item.quantity
      };
    });
    
    const createdProducts = await Promise.all(productCreationPromises);
    
    // STEP 2: Create line items for draft order
    const lineItems = createdProducts.map(product => ({
      variantId: product.variantId,
      quantity: product.quantity
    }));
    
    console.log('Line items for draft order:', JSON.stringify(lineItems, null, 2));
    
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
      console.error("Draft order user errors:", data.userErrors);
      
      // If draft order fails, clean up created products
      console.log('Cleaning up created products...');
      await Promise.all(createdProducts.map(async (product) => {
        try {
          await fetch(`${shopifyRestEndpoint}/products/${product.productId}.json`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
            },
          });
          console.log(`Deleted product ${product.productId}`);
        } catch (err) {
          console.error(`Failed to delete product ${product.productId}:`, err);
        }
      }));
      
      throw new Error(`Shopify validation error: ${data.userErrors[0].message}`);
    }
    
    if (data?.draftOrder?.invoiceUrl) {
      console.log('SUCCESS! Checkout URL generated:', data.draftOrder.invoiceUrl);
      console.log(`Created ${createdProducts.length} product(s) for this order`);
      
      // Return success with product IDs for potential cleanup later
      return res.status(200).json({ 
        checkoutUrl: data.draftOrder.invoiceUrl,
        productIds: createdProducts.map(p => p.productId)
      });
    } else {
      console.error("No invoice URL in response:", JSON.stringify(draftOrderResult, null, 2));
      
      // Clean up created products
      console.log('Cleaning up created products...');
      await Promise.all(createdProducts.map(async (product) => {
        try {
          await fetch(`${shopifyRestEndpoint}/products/${product.productId}.json`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
            },
          });
          console.log(`Deleted product ${product.productId}`);
        } catch (err) {
          console.error(`Failed to delete product ${product.productId}:`, err);
        }
      }));
      
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
