// v5.5 - Create Products with Image Upload + Country Detection (Updated for shpss_ OAuth flow)
export default async function handler(req, res) {
  // --- BULLETPROOF CORS HEADERS ---
  // Dynamically allow the exact domain that is making the request
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, PATCH, DELETE, POST, PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle the OPTIONS preflight request immediately
  if (req.method === 'OPTIONS') { 
    return res.status(200).end(); 
  }
  
  // Enforce POST method
  if (req.method !== 'POST') { 
    return res.status(405).json({ error: 'Method Not Allowed' }); 
  }
  // --------------------------------
  
  // UPDATED: Now using Client ID and Client Secret (shpss_)
  const { MASTER_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;
  if (!MASTER_STORE_DOMAIN || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
      console.error("CRITICAL: Missing environment variables!");
      return res.status(500).json({ error: "Server configuration error." });
  }
  
  const API_VERSION = '2026-04'; 
  const shopifyRestEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/${API_VERSION}`;
  const shopifyGraphQLEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
  
  try {
    // STEP 1: Exchange shpss_ Client Secret for a temporary Access Token
    console.log("Requesting temporary access token from Shopify..."  );
    const tokenResponse = await fetch(`https://${MASTER_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        grant_type: 'client_credentials'
      }  )
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(`OAuth Error: ${JSON.stringify(tokenData)}`);
    }
    
    // This is the temporary token we will use for the rest of the script
    const ADMIN_API_ACCESS_TOKEN = tokenData.access_token;
    console.log("Successfully acquired temporary access token.");

    const { items, currency, country } = req.body;
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log(`Creating ${items.length} new product(s)...`);
    if (country) console.log(`Visitor country: ${country}`);
    
    // STEP 2: Create products and upload images
    const productCreationPromises = items.map(async (item, index) => {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 6);
      
      let imageUrl = null;
      if (item.image) {
        imageUrl = item.image;
        if (!imageUrl.startsWith('http://'  ) && !imageUrl.startsWith('https://'  )) {
          imageUrl = `https:${imageUrl.replace(/^\/+/, ''  )}`;
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
      
      // Upload image
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
    
    // STEP 3: Create draft order
    const lineItems = createdProducts.map(product => ({
      variantId: product.variantId,
      quantity: product.quantity
    }));
    
    const draftOrderInput = {
      lineItems: lineItems,
      presentmentCurrencyCode: currency
    };
    
    if (country) {
      draftOrderInput.marketRegionCountryCode = country;
      console.log(`Setting marketRegionCountryCode to: ${country}`);
    }
    
    // STEP 4: Create draft order using GraphQL
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
        variables: { input: draftOrderInput }, 
      }),
    });
    
    const draftOrderResult = await draftOrderResponse.json();
    const data = draftOrderResult.data?.draftOrderCreate;
    
    if (data?.userErrors && data.userErrors.length > 0) {
      // Cleanup on failure
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
      
      if (country) {
        try {
          const url = new URL(checkoutUrl);
          const locale = `en-${country.toLowerCase()}`;
          const currentPath = url.pathname;
          
          const localePattern = /\/[a-z]{2}-[a-z]{2}\//;
          if (localePattern.test(currentPath)) {
            url.pathname = currentPath.replace(localePattern, `/${locale}/`);
          }
          
          url.searchParams.set('locale', locale);
          url.searchParams.set('country', country);
          
          checkoutUrl = url.toString();
        } catch (err) {
          console.error('Failed to modify URL:', err);
        }
      }
      
      return res.status(200).json({ 
        checkoutUrl: checkoutUrl,
        productIds: createdProducts.map(p => p.productId)
      });
    } else {
      throw new Error('Could not create checkout URL.');
    }
    
  } catch (error) {
    console.error("Error:", error.message);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
