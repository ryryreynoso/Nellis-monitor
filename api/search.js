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

    // Import axios for web search
    const axios = (await import('axios')).default;

    const allListings = [];

    for (const keyword of searchTerms) {
      try {
        // Use DuckDuckGo HTML search (no API key needed)
        const searchQuery = `site:nellisauction.com ${keyword}`;
        const response = await axios.get('https://html.duckduckgo.com/html/', {
          params: { q: searchQuery },
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
          },
          timeout: 10000
        });

        const cheerio = (await import('cheerio')).default;
        const $ = cheerio.load(response.data);
        
        // Parse DuckDuckGo results
        $('.result').each((i, elem) => {
          const $result = $(elem);
          const link = $result.find('.result__url').attr('href');
          const title = $result.find('.result__title').text().trim();
          const snippet = $result.find('.result__snippet').text().trim();
          
          // Extract item ID from URL
          const itemIdMatch = link?.match(/nellisauction\.com\/item\/(\d+)/);
          const itemId = itemIdMatch?.[1];
          
          // Extract price from snippet if available
          const priceMatch = snippet?.match(/\$\d+(?:\.\d{2})?/);
          const price = priceMatch ? priceMatch[0] : 'See listing';
          
          if (itemId && title) {
            allListings.push({
              id: itemId,
              title: title.substring(0, 150),
              price,
              url: `https://nellisauction.com/item/${itemId}`,
              matchedKeyword: keyword,
              timestamp: new Date().toISOString(),
              snippet: snippet.substring(0, 200)
            });
          }
        });

        // If no results from DuckDuckGo, try direct Nellis search page
        if (allListings.length === 0) {
          const nellisResponse = await axios.get(`https://nellisauction.com/search`, {
            params: { query: keyword },
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
            },
            timeout: 10000
          });

          const $nellis = cheerio.load(nellisResponse.data);
          
          // Try to find item links in the HTML
          $nellis('a[href*="/item/"]').each((i, elem) => {
            const href = $nellis(elem).attr('href');
            const itemId = href?.match(/\/item\/(\d+)/)?.[1];
            
            if (itemId && i < 20) { // Limit to first 20 items
              allListings.push({
                id: itemId,
                title: `${keyword} item #${itemId}`,
                price: 'See listing',
                url: `https://nellisauction.com${href}`,
                matchedKeyword: keyword,
                timestamp: new Date().toISOString()
              });
            }
          });
        }

      } catch (err) {
        console.error(`Error searching ${keyword}:`, err.message);
      }
    }

    // Remove duplicates by ID
    const uniqueListings = Array.from(
      new Map(allListings.map(item => [item.id, item])).values()
    );

    return res.status(200).json({
      success: true,
      totalListings: uniqueListings.length,
      listings: uniqueListings
    });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Search failed',
      message: error.message 
    });
  }
}
