// FINAL CORRECTED CODE - v5.0
// - Fixes image association by first uploading image, then creating variant.
// - Fixes incorrect pricing by setting taxesIncluded: true.
// - Fixes the "only one item" bug by removing the flawed single-variant logic.
// - Adds automatic cleanup of temporary variants after checkout creation.
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Access-Token');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method Not Allowed' }); }

  // --- Configuration & Validation ---
  const { MASTER_STORE_DOMAIN, ADMIN_API_ACCESS_TOKEN, TEMPLATE_PRODUCT_ID } = process.env;
  if (!MASTER_STORE_DOMAIN || !ADMIN_API_ACCESS_TOKEN || !TEMPLATE_PRODUCT_ID) {
    console.error("CRITICAL: Missing environment variables!");
    return res.status(500).json({ error: "Server configuration error." });
  }

  const shopifyRestEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-04`; // Use a stable API version
  const shopifyGraphQLEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-04/graphql.json`;
  
  // A helper function to create consistent headers
  const getShopifyHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
  });

  // --- Main Logic ---
  const createdVariantIds = []; // Keep track of variants to delete later

  try {
    const { items, currency } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Request body must include an array of items.' });
    }
    console.log('Request received for items:', JSON.stringify(items, null, 2));

    // --- STEP 1: Create a unique variant for each line item ---
    // This is the single, reliable strategy that works for all cases.
    console.log('Creating unique variants for each cart item...');
    
    const lineItemPromises = items.map(async (item, index) => {
      // --- A: Handle Image (if provided) ---
      let imageId = null;
      if (item.image) {
        try {
          console.log(`Uploading image for item ${index}: ${item.title}`);
          const imageResponse = await fetch(`${shopifyRestEndpoint}/products/${TEMPLATE_PRODUCT_ID}/images.json`, {
            method: 'POST',
            headers: getShopifyHeaders(),
            body: JSON.stringify({ image: { src: item.image } }),
          });
          const imageData = await imageResponse.json();
          if (!imageResponse.ok || !imageData.image?.id) {
            console.warn(`Could not upload image for item ${index}. Proceeding without it.`, imageData);
          } else {
            imageId = imageData.image.id;
            console.log(`Image uploaded successfully for item ${index}. Image ID: ${imageId}`);
          }
        } catch (imgError) {
          console.warn(`Error uploading image for item ${index}:`, imgError);
        }
      }

      // --- B: Create the Variant ---
      // We create a unique option value to ensure Shopify creates a new variant.
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const uniqueOption = `${item.title.substring(0, 40)}-${timestamp}-${random}`;
      
      const variantPayload = {
        variant: {
          option1: uniqueOption,
          price: item.price.toString(),
          inventory_policy: 'deny',
          inventory_management: null, // Don't track inventory for these temporary items
          requires_shipping: true,
          // Associate the uploaded image ID here
          ...(imageId && { image_id: imageId }),
        }
      };

      console.log(`Creating variant ${index} with payload:`, JSON.stringify(variantPayload, null, 2));
      const variantResponse = await fetch(`${shopifyRestEndpoint}/products/${TEMPLATE_PRODUCT_ID}/variants.json`, {
        method: 'POST',
        headers: getShopifyHeaders(),
        body: JSON.stringify(variantPayload),
      });

      const variantResult = await variantResponse.json();
      if (!variantResponse.ok || !variantResult.variant?.id) {
        console.error(`Failed to create variant ${index}:`, JSON.stringify(variantResult, null, 2));
        throw new Error(`Failed to create variant: ${JSON.stringify(variantResult.errors || 'Unknown error')}`);
      }

      const createdVariant = variantResult.variant;
      console.log(`Successfully created variant ${index}: ID ${createdVariant.id}`);
      createdVariantIds.push(createdVariant.id); // Store REST ID for cleanup

      return {
        variantId: `gid://shopify/ProductVariant/${createdVariant.id}`, // GraphQL ID for draft order
        quantity: item.quantity,
        title: item.title, // Pass title to draft order for clarity
      };
    });

    const lineItems = await Promise.all(lineItemPromises);
    console.log('Line items ready for draft order:', JSON.stringify(lineItems, null, 2));

    // --- STEP 2: Create Draft Order with the new variants ---
    const draftOrderMutation = `
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id invoiceUrl }
          userErrors { field message }
        }
      }
    `;

    const draftOrderInput = {
      input: {
        lineItems: lineItems,
        presentmentCurrencyCode: currency,
        // *** PRICE FIX ***: Tell Shopify the prices already include tax.
        taxesIncluded: true,
      }
    };

    console.log('Creating draft order with input:', JSON.stringify(draftOrderInput, null, 2));
    const draftOrderResponse = await fetch(shopifyGraphQLEndpoint, {
      method: 'POST',
      headers: getShopifyHeaders(),
      body: JSON.stringify({
        query: draftOrderMutation,
        variables: draftOrderInput,
      }),
    });

    const draftOrderResult = await draftOrderResponse.json();
    console.log('Draft order creation result:', JSON.stringify(draftOrderResult, null, 2));
    
    const data = draftOrderResult.data?.draftOrderCreate;
    if (data?.userErrors?.length > 0) {
      throw new Error(`Shopify validation error: ${data.userErrors[0].message}`);
    }

    if (!data?.draftOrder?.invoiceUrl) {
      throw new Error('Could not create the draft order checkout URL.');
    }

    console.log('SUCCESS! Checkout URL:', data.draftOrder.invoiceUrl);
    return res.status(200).json({ checkoutUrl: data.draftOrder.invoiceUrl });

  } catch (error) {
    console.error("=== CRITICAL ERROR ENCOUNTERED ===");
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
    return res.status(500).json({
      error: error.message || 'An internal server error occurred.',
    });
  } finally {
    // --- STEP 3: Cleanup ---
    // Delete the temporary variants we created, regardless of success or failure (after this point).
    if (createdVariantIds.length > 0) {
      console.log(`Cleaning up ${createdVariantIds.length} temporary variants...`);
      const cleanupPromises = createdVariantIds.map(variantId =>
        fetch(`${shopifyRestEndpoint}/products/${TEMPLATE_PRODUCT_ID}/variants/${variantId}.json`, {
          method: 'DELETE',
          headers: getShopifyHeaders(),
        })
      );
      
      try {
        await Promise.all(cleanupPromises);
        console.log("Cleanup complete.");
      } catch (cleanupError) {
        console.error("Failed to clean up all temporary variants:", cleanupError);
      }
    }
  }
}
