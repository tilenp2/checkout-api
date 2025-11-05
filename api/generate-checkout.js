// CORRECTED CODE - v4.7 - Currency & Multi-Product Fix
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Access-Token');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method Not Allowed' }); }
  
  const { MASTER_STORE_DOMAIN, ADMIN_API_ACCESS_TOKEN, TEMPLATE_PRODUCT_ID, STORE_BASE_CURRENCY } = process.env;
  if (!MASTER_STORE_DOMAIN || !ADMIN_API_ACCESS_TOKEN || !TEMPLATE_PRODUCT_ID) {
      console.error("CRITICAL: Missing environment variables!");
      return res.status(500).json({ error: "Server configuration error." });
  }
  
  // Default to EUR if not specified
  const baseCurrency = STORE_BASE_CURRENCY || 'EUR';
  
  const shopifyRestEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-10`;
  const shopifyGraphQLEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-10/graphql.json`;
  
  // Exchange rates (update these regularly or use an API)
  const exchangeRates = {
    'EUR': 1.0,
    'GBP': 1.17,  // 1 GBP = 1.17 EUR (example rate)
    'USD': 0.92,  // 1 USD = 0.92 EUR (example rate)
    // Add more currencies as needed
  };
  
  // Helper function to convert price to base currency (EUR)
  function convertToBaseCurrency(price, fromCurrency) {
    if (fromCurrency === baseCurrency) {
      return price;
    }
    
    const rate = exchangeRates[fromCurrency];
    if (!rate) {
      console.warn(`No exchange rate for ${fromCurrency}, using original price`);
      return price;
    }
    
    // Convert to EUR
    const convertedPrice = price * rate;
    console.log(`Converted ${price} ${fromCurrency} to ${convertedPrice.toFixed(2)} ${baseCurrency}`);
    return convertedPrice;
  }
  
  try {
    const { items, currency } = req.body;
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    // Convert all prices to base currency
    const convertedItems = items.map(item => ({
      ...item,
      originalPrice: item.price,
      originalCurrency: currency,
      price: convertToBaseCurrency(item.price, currency)
    }));
    
    console.log('Converted items:', JSON.stringify(convertedItems, null, 2));
    
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
    const product = productData.product;
    console.log('Current product state:', JSON.stringify({
      title: product.title,
      options: product.options,
      variants: product.variants?.length
    }, null, 2));
    
    // Check if product has multiple variants (more than just default)
    const hasMultipleVariants = product.variants && product.variants.length > 1;
    const hasVariantOptions = product.options && product.options.length > 0 && 
                              product.options.some(opt => opt.name !== 'Title' && opt.values.length > 1);
    
    const useVariants = hasMultipleVariants || hasVariantOptions;
    
    console.log(`Product variant strategy: ${useVariants ? 'CREATE_VARIANTS' : 'UPDATE_PRODUCT'}`);
    
    let lineItems = [];
    
    if (useVariants) {
      // STRATEGY A: Product has variants - create new variants for each item
      console.log('Creating variants for cart items...');
      
      const variantCreationPromises = convertedItems.map(async (item, index) => {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const uniqueOption = `${item.title.substring(0, 40)}-${timestamp}-${random}`;
        
        const variantData = {
          variant: {
            option1: uniqueOption,
            price: item.price.toFixed(2), // Use converted price
            inventory_policy: 'deny',
            inventory_management: null,
            requires_shipping: true,
          }
        };
        
        // Add image if provided
        if (item.image) {
          variantData.variant.image_src = item.image;
        }
        
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
          console.error(`Failed to create variant ${index}:`, JSON.stringify(result, null, 2));
          throw new Error(`Failed to create variant: ${JSON.stringify(result.errors)}`);
        }
        
        console.log(`Successfully created variant ${index}: ID ${result.variant.id}`);
        
        // Add line item with custom properties to track original product info
        return {
          variantId: `gid://shopify/ProductVariant/${result.variant.id}`,
          quantity: item.quantity,
          customAttributes: [
            { key: "_original_product", value: item.title },
            { key: "_original_price", value: `${item.originalPrice} ${item.originalCurrency}` },
            { key: "_base_price", value: `${item.price.toFixed(2)} ${baseCurrency}` }
          ]
        };
      });
      
      lineItems = await Promise.all(variantCreationPromises);
      
    } else {
      // STRATEGY B: Product has NO variants - update product title/image and use existing variant
      console.log('Updating product details (no variant creation)...');
      
      // For single-item carts, update the product
      const firstItem = convertedItems[0];
      
      const productUpdatePayload = {
        product: {
          id: parseInt(TEMPLATE_PRODUCT_ID),
          title: firstItem.title,
        }
      };
      
      // Add image if provided
      if (firstItem.image) {
        productUpdatePayload.product.images = [
          {
            src: firstItem.image,
            position: 1
          }
        ];
      }
      
      // Update the existing variant's price (use converted price)
      if (product.variants && product.variants.length > 0) {
        const existingVariantId = product.variants[0].id;
        productUpdatePayload.product.variants = [
          {
            id: existingVariantId,
            price: firstItem.price.toFixed(2), // Use converted price
            inventory_policy: 'deny',
            inventory_management: null
          }
        ];
      }
      
      console.log('Updating product:', JSON.stringify(productUpdatePayload, null, 2));
      
      const updateResponse = await fetch(`${shopifyRestEndpoint}/products/${TEMPLATE_PRODUCT_ID}.json`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
        body: JSON.stringify(productUpdatePayload),
      });
      
      const updateResult = await updateResponse.json();
      
      if (!updateResponse.ok) {
        console.error('Failed to update product:', JSON.stringify(updateResult, null, 2));
        throw new Error('Failed to update product details');
      }
      
      console.log('Product updated successfully');
      
      // Use the existing variant for all items
      const variantId = updateResult.product.variants[0].id;
      const totalQuantity = convertedItems.reduce((sum, item) => sum + item.quantity, 0);
      
      lineItems = [
        {
          variantId: `gid://shopify/ProductVariant/${variantId}`,
          quantity: totalQuantity,
          customAttributes: [
            { key: "_original_product", value: firstItem.title },
            { key: "_original_price", value: `${firstItem.originalPrice} ${firstItem.originalCurrency}` },
            { key: "_base_price", value: `${firstItem.price.toFixed(2)} ${baseCurrency}` }
          ]
        }
      ];
    }
    
    console.log('Line items for draft order:', JSON.stringify(lineItems, null, 2));
    
    // STEP 2: Create draft order using GraphQL
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
            // Use base currency for the draft order
            presentmentCurrencyCode: baseCurrency
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
