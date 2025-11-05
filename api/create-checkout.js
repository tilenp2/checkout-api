// --- TEMPORARY DIAGNOSTIC SCRIPT ---
// This file will test if Vercel is installing dependencies correctly.

export default async function handler(req, res) {
  // Set CORS headers so we can see the response in the browser console
  res.setHeader('Access-control-Allow-Origin', '*');
  res.setHeader('Access-control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }

  let shopifyStatus = 'Not loaded';
  let shopifyError = null;
  let uuidStatus = 'Not loaded';
  let uuidError = null;
  let uuidValue = null;

  // --- Test 1: Try to load the simple 'uuid' package ---
  try {
    const { v4: uuidv4 } = require('uuid');
    uuidStatus = 'SUCCESSFULLY LOADED';
    uuidValue = uuidv4();
  } catch (e) {
    uuidStatus = 'FAILED TO LOAD!';
    uuidError = e.message;
  }

  // --- Test 2: Try to load the Shopify package ---
  try {
    const { Shopify } = require('@shopify/shopify-api');
    if (Shopify && Shopify.Clients) {
        shopifyStatus = 'SUCCESSFULLY LOADED';
    } else {
        shopifyStatus = 'Loaded, but the object is invalid or empty.';
    }
  } catch (e) {
    shopifyStatus = 'FAILED TO LOAD!';
    shopifyError = e.message;
  }

  // Send the diagnostic report back to the browser
  res.status(200).json({
    diagnosticReport: {
      message: "This is a report from the Vercel server's dependency test.",
      uuidPackage: {
        status: uuidStatus,
        error: uuidError,
        generatedId: uuidValue
      },
      shopifyPackage: {
        status: shopifyStatus,
        error: shopifyError
      }
    }
  });
}
