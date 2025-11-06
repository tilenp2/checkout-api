// v5.3 - Create Products with Image Upload + Country Detection
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
    const { items, currency, country } = req.body;
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log(`Creating ${items.length} new product(s)...`);
    if (country) console.log(`Visitor country: ${country}`);
    
    // STEP 1: Create products and upload images (wait for images to complete)
    const productCreationPromises = items.map(async (item, index) => {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 6);
      
      // Prepare image URL once
      let imageUrl = null;
      if (item.image) {
        imageUrl = item.image;
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          imageUrl = `https:${imageUrl.replace(/^\/+/, '')}`;
        }
      }
      
      const productData = {
        product: {
          title: item.title,
          body_html: item.description || '',
          vendor: "Cart",
          product_type: "Item",
          status: "active",
          published: false,
          variants: [{
            price: item.price.toString(),
            inventory_policy: 'deny',
            inventory_management: null,
            sku: `C-${timestamp}-${random}`
          }]
        }
      };
      
      // Create product
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
        throw new Error(`Failed to create product: ${JSON.stringify(result.errors)}`);
      }
      
      const productId = result.product.id;
      const variantId = result.product.variants[0].id;
      
      // Upload image and WAIT for completion
      if (imageUrl) {
        try {
          await fetch(`${shopifyRestEndpoint}/products/${productId}/images.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
            },
            body: JSON.stringify({ image: { src: imageUrl } }),
          });
        } catch (err) {
          console.error(`Image upload failed for ${productId}`);
        }
      }
      
      return {
        productId: productId,
        variantId: `gid://shopify/ProductVariant/${variantId}`,
        quantity: item.quantity
      };
    });
    
    const createdProducts = await Promise.all(productCreationPromises);
    
    // STEP 2: Create draft order with shipping address
    const lineItems = createdProducts.map(product => ({
      variantId: product.variantId,
      quantity: product.quantity
    }));
    
    // Build draft order input with country
    const draftOrderInput = {
      lineItems: lineItems,
      presentmentCurrencyCode: currency
    };
    
    // Add shipping address with country if provided
    if (country) {
      draftOrderInput.shippingAddress = {
        countryCode: country
      };
    }
    
    // STEP 3: Create draft order using GraphQL
    const draftOrderMutation = `
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id invoiceUrl }
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
        variables: { 
          input: draftOrderInput
        }, 
      }),
    });
    
    const draftOrderResult = await draftOrderResponse.json();
    const data = draftOrderResult.data?.draftOrderCreate;
    
    if (data?.userErrors && data.userErrors.length > 0) {
      // If draft order fails, clean up created products
      await Promise.all(createdProducts.map(product =>
        fetch(`${shopifyRestEndpoint}/products/${product.productId}.json`, {
          method: 'DELETE',
          headers: { 'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN },
        }).catch(() => {})
      ));
      throw new Error(`Shopify error: ${data.userErrors[0].message}`);
    }
    
    if (data?.draftOrder?.invoiceUrl) {
      let checkoutUrl = data.draftOrder.invoiceUrl;
      
      // Append country parameter to URL if country was detected
      if (country) {
        const url = new URL(checkoutUrl);
        url.searchParams.set('country', country);
        checkoutUrl = url.toString();
      }
      
      return res.status(200).json({ 
        checkoutUrl: checkoutUrl,
        productIds: createdProducts.map(p => p.productId)
      });
    } else {
      // Clean up created products
      await Promise.all(createdProducts.map(product =>
        fetch(`${shopifyRestEndpoint}/products/${product.productId}.json`, {
          method: 'DELETE',
          headers: { 'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN },
        }).catch(() => {})
      ));
      throw new Error('Could not create checkout URL.');
    }
    
  } catch (error) {
    console.error("Error:", error.message);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
