export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { keywords } = req.method === 'POST' ? req.body : req.query;
    const searchTerms = Array.isArray(keywords) ? keywords : [keywords];

    const axios = (await import('axios')).default;
    const allListings = [];

    // Try the mobile API endpoint
    for (const keyword of searchTerms) {
      const endpoints = [
        `https://mobile.nellisauction.com/api/search?q=${keyword}`,
        `https://mobile.nellisauction.com/search?query=${keyword}`,
        `https://mobile.nellisauction.com/api/items?search=${keyword}`,
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(endpoint, {
            headers: {
              'User-Agent': 'NellisAuction/1.0 (iPhone)',
              'Accept': 'application/json',
            },
            timeout: 5000
          });

          if (response.data && Array.isArray(response.data)) {
            allListings.push(...response.data.map(item => ({
              id: item.id,
              title: item.title || item.name,
              price: item.price || item.currentBid,
              url: `https://nellisauction.com/item/${item.id}`,
              matchedKeyword: keyword,
              timestamp: new Date().toISOString()
            })));
            break; // Found working endpoint
          }
        } catch (err) {
          // Try next endpoint
          continue;
        }
      }
    }

    return res.status(200).json({
      success: true,
      totalListings: allListings.length,
      listings: allListings
    });

  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}
