// /api/test-connection.js - The "Are You Open?" Test

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Access-Token');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }

  const { MASTER_STORE_DOMAIN, ADMIN_API_ACCESS_TOKEN } = process.env;

  if (!MASTER_STORE_DOMAIN || !ADMIN_API_ACCESS_TOKEN) {
      return res.status(500).json({ error: "Server configuration error." });
  }

  const shopifyGraphQLEndpoint = `https://${MASTER_STORE_DOMAIN}/admin/api/2024-04/graphql.json`;
  
  const testQuery = `{ shop { name } }`;

  try {
    const response = await fetch(shopifyGraphQLEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query: testQuery }),
    });

    const data = await response.json();
    
    console.log("Shopify Test Response:", data);

    res.status(200).json(data);

  } catch (error) {
    console.error("Test connection failed:", error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
