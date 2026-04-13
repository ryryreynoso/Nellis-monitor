
// Vercel Serverless Function for Nellis Auction Search
// Deploy to Vercel for free serverless backend
// File: api/search.js

const axios = require('axios');
const cheerio = require('cheerio');

// In-memory cache (resets on cold start, use Vercel KV in production)
const cache = new Map();

function parseNellisHTML(html) {
    const $ = cheerio.load(html);
    const listings = [];
    
    // Parse Nellis auction items
    $('.search-result-item, .auction-item, [data-testid*="item"], .item-card').each((i, elem) => {
        try {
            const $elem = $(elem);
            const title = $elem.find('.item-title, .product-title, h3, h4, .title').first().text().trim();
            const link = $elem.find('a').first().attr('href') || '';
            const itemId = link.match(/\/item\/(\d+)/)?.[1] || `${Date.now()}-${i}`;
            const price = $elem.find('.price, .current-bid, .bid-amount').first().text().trim();
            const image = $elem.find('img').first().attr('src') || '';
            
            if (title && itemId) {
                listings.push({
                    id: itemId,
                    title,
                    price,
                    url: link.startsWith('http') ? link : `https://nellisauction.com${link}`,
                    image,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (err) {
            console.error('Parse error:', err);
        }
    });
    
    return listings;
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    const { keyword, keywords } = req.method === 'POST' ? req.body : req.query;
    const searchTerms = keywords ? JSON.parse(keywords) : [keyword];
    
    if (!searchTerms || searchTerms.length === 0) {
        return res.status(400).json({ error: 'Keyword(s) required' });
    }
    
    try {
        const results = await Promise.allSettled(
            searchTerms.map(async (term) => {
                const cacheKey = `search:${term}`;
                const cached = cache.get(cacheKey);
                
                // Cache for 5 minutes
                if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
                    return { keyword: term, listings: cached.listings, cached: true };
                }
                
                const response = await axios.get(`https://nellisauction.com/search`, {
                    params: { query: term },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    },
                    timeout: 8000
                });
                
                const listings = parseNellisHTML(response.data);
                cache.set(cacheKey, { listings, timestamp: Date.now() });
                
                return { keyword: term, listings, cached: false };
            })
        );
        
        const successful = results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);
        
        const allListings = successful.flatMap(r => 
            r.listings.map(l => ({ ...l, matchedKeyword: r.keyword }))
        );
        
        res.status(200).json({
            success: true,
            results: successful,
            totalListings: allListings.length,
            listings: allListings
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ 
            error: 'Search failed',
            message: error.message 
        });
    }
}
