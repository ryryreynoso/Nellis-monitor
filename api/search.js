export default async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET, POST, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);

if (req.method === ‘OPTIONS’) {
return res.status(200).end();
}

try {
const { keywords } = req.method === ‘POST’ ? req.body : req.query;
const searchTerms = Array.isArray(keywords) ? keywords : [keywords];

```
if (!searchTerms || searchTerms.length === 0 || !searchTerms[0]) {
  return res.status(400).json({ 
    success: false, 
    error: 'Keywords required' 
  });
}

const axios = (await import('axios')).default;
const allListings = [];

// Try the mobile API endpoint we discovered
for (const keyword of searchTerms) {
  // Try multiple possible endpoint patterns
  const endpoints = [
    `https://mobile.nellisauction.com/api/search?q=${encodeURIComponent(keyword)}`,
    `https://mobile.nellisauction.com/api/search?query=${encodeURIComponent(keyword)}`,
    `https://mobile.nellisauction.com/search?q=${encodeURIComponent(keyword)}`,
    `https://mobile.nellisauction.com/api/items?search=${encodeURIComponent(keyword)}`,
    `https://mobile.nellisauction.com/api/v1/search?q=${encodeURIComponent(keyword)}`,
  ];

  let foundWorkingEndpoint = false;

  for (const endpoint of endpoints) {
    try {
      console.log(`Trying endpoint: ${endpoint}`);
      
      const response = await axios.get(endpoint, {
        headers: {
          'User-Agent': 'NellisAuction/2.16.1 (iPhone; iOS 16.0)',
          'Accept': 'application/json',
          'Accept-Language': 'en-US',
        },
        timeout: 8000,
        validateStatus: (status) => status < 500 // Accept 404, etc to try next endpoint
      });

      // Check if we got valid data
      if (response.status === 200 && response.data) {
        console.log(`Success! Endpoint ${endpoint} returned data`);
        
        // Try to parse the response - format might vary
        let items = [];
        
        if (Array.isArray(response.data)) {
          items = response.data;
        } else if (response.data.items && Array.isArray(response.data.items)) {
          items = response.data.items;
        } else if (response.data.results && Array.isArray(response.data.results)) {
          items = response.data.results;
        } else if (response.data.data && Array.isArray(response.data.data)) {
          items = response.data.data;
        }

        // Convert items to our format
        items.forEach(item => {
          allListings.push({
            id: item.id || item.itemId || item._id || Date.now(),
            title: item.title || item.name || item.description || 'Untitled',
            price: item.price || item.currentBid || item.startingBid || 'See listing',
            url: item.url || `https://nellisauction.com/item/${item.id || item.itemId}`,
            matchedKeyword: keyword,
            timestamp: new Date().toISOString()
          });
        });

        foundWorkingEndpoint = true;
        break; // Found working endpoint for this keyword
      }

    } catch (err) {
      console.log(`Endpoint ${endpoint} failed: ${err.message}`);
      // Try next endpoint
      continue;
    }
  }

  if (!foundWorkingEndpoint) {
    console.log(`No working endpoint found for keyword: ${keyword}`);
  }
}

// Remove duplicates
const uniqueListings = Array.from(
  new Map(allListings.map(item => [item.id, item])).values()
);

return res.status(200).json({
  success: true,
  totalListings: uniqueListings.length,
  listings: uniqueListings,
  message: uniqueListings.length === 0 ? 'No items found or API endpoint not yet discovered' : undefined
});
```

} catch (error) {
console.error(‘Handler error:’, error);
return res.status(500).json({
success: false,
error: ‘Search failed’,
message: error.message
});
}
}