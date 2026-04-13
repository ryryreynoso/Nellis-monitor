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

    // Import axios dynamically
    const axios = (await import('axios')).default;
    const cheerio = (await import('cheerio')).default;

    const allListings = [];

    for (const keyword of searchTerms) {
      try {
        const response = await axios.get(`https://nellisauction.com/search`, {
          params: { query: keyword },
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
            'Accept': 'text/html,application/xhtml+xml',
          },
          timeout: 10000
        });

        const $ = cheerio.load(response.data);
        
        // Try multiple possible selectors
        const items = $('.search-result-item, .auction-item, [data-testid*="item"], .item-card, article, .product');
        
        items.each((i, elem) => {
          const $elem = $(elem);
          const title = $elem.find('.item-title, .product-title, h3, h4, .title, h2').first().text().trim();
          const link = $elem.find('a').first().attr('href') || '';
          const itemId = link.match(/\/item\/(\d+)/)?.[1] || `${Date.now()}-${i}`;
          const price = $elem.find('.price, .current-bid, .bid-amount, .amount').first().text().trim();
          
          if (title && title.length > 3) {
            allListings.push({
              id: itemId,
              title,
              price: price || 'See listing',
              url: link.startsWith('http') ? link : `https://nellisauction.com${link}`,
              matchedKeyword: keyword,
              timestamp: new Date().toISOString()
            });
          }
        });
      } catch (err) {
        console.error(`Error searching ${keyword}:`, err.message);
      }
    }

    return res.status(200).json({
      success: true,
      totalListings: allListings.length,
      listings: allListings
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
