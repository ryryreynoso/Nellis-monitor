export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { keywords } = req.method === 'POST' ? req.body : req.query;
    const searchTerms = Array.isArray(keywords) ? keywords : [keywords];

    if (!searchTerms || searchTerms.length === 0 || !searchTerms[0]) {
      return res.status(400).json({ 
        success: false, 
        error: 'Keywords required' 
      });
    }

    const axios = (await import('axios')).default;
    const cheerio = (await import('cheerio')).default;

    const results = [];

    for (const keyword of searchTerms) {
      try {
        // Fetch Nellis search page
        const response = await axios.get(`https://nellisauction.com/search`, {
          params: { query: keyword },
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const html = response.data;
        
        // Look for item count in the page
        // Nellis usually shows "X items found" or similar
        const countMatch = html.match(/(\d+)\s*items?\s*found/i) || 
                          html.match(/found\s*(\d+)\s*items?/i) ||
                          html.match(/(\d{1,5})\s*results?/i);
        
        const itemCount = countMatch ? parseInt(countMatch[1]) : 0;
        
        // Also count how many item links we can find
        const itemLinks = $('a[href*="/item/"]').length;
        
        // Generate a unique "signature" for current results
        // This helps detect new items
        const firstItemId = $('a[href*="/item/"]').first().attr('href')?.match(/\/item\/(\d+)/)?.[1];
        
        results.push({
          keyword,
          totalItems: itemCount || itemLinks,
          visibleItems: itemLinks,
          firstItemId: firstItemId || null,
          timestamp: new Date().toISOString(),
          searchUrl: `https://nellisauction.com/search?query=${encodeURIComponent(keyword)}`
        });

      } catch (err) {
        console.error(`Error checking ${keyword}:`, err.message);
        results.push({
          keyword,
          totalItems: 0,
          visibleItems: 0,
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    return res.status(200).json({
      success: true,
      results,
      // Convert to listings format for frontend compatibility
      listings: results.filter(r => r.totalItems > 0).map(r => ({
        id: `${r.keyword}-${r.firstItemId || Date.now()}`,
        title: `${r.totalItems} ${r.keyword} items on Nellis`,
        matchedKeyword: r.keyword,
        url: r.searchUrl,
        price: 'Click to browse',
        timestamp: r.timestamp,
        count: r.totalItems
      })),
      totalListings: results.reduce((sum, r) => sum + (r.totalItems || 0), 0)
    });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Check failed',
      message: error.message 
    });
  }
}
