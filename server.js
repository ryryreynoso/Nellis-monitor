// Nellis Auction Monitor - Backend Proxy Server
// This server fetches listings from Nellis Auction and serves them to the frontend

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins (restrict this in production)
app.use(cors());
app.use(express.json());

// In-memory storage for tracking seen items (use Redis/database in production)
const seenItems = new Map();

// Utility to extract listing data from Nellis search results
function parseNellisHTML(html) {
    const $ = cheerio.load(html);
    const listings = [];
    
    // Nellis uses a card-based layout - we need to inspect their actual HTML structure
    // This is a template - you'll need to adjust selectors based on their actual DOM
    $('.search-result-item, .auction-item, [data-testid*="item"], .item-card').each((i, elem) => {
        try {
            const $elem = $(elem);
            
            // Try multiple possible selectors for title
            const title = $elem.find('.item-title, .product-title, h3, h4, .title').first().text().trim();
            
            // Try to find the item ID or URL
            const link = $elem.find('a').first().attr('href') || '';
            const itemId = link.match(/\/item\/(\d+)/)?.[1] || 
                          $elem.attr('data-id') || 
                          $elem.attr('data-item-id') ||
                          `${Date.now()}-${i}`;
            
            // Try to find price
            const price = $elem.find('.price, .current-bid, .bid-amount').first().text().trim();
            
            // Try to find image
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
            console.error('Error parsing item:', err);
        }
    });
    
    return listings;
}

// Endpoint to search Nellis Auction
app.get('/api/search', async (req, res) => {
    const { keyword } = req.query;
    
    if (!keyword) {
        return res.status(400).json({ error: 'Keyword parameter required' });
    }
    
    try {
        console.log(`Searching Nellis for: ${keyword}`);
        
        // Fetch search results from Nellis
        const response = await axios.get(`https://nellisauction.com/search`, {
            params: { query: keyword },
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: 10000
        });
        
        const listings = parseNellisHTML(response.data);
        
        // Filter for new items
        const newListings = listings.filter(item => {
            const seen = seenItems.get(item.id);
            if (!seen) {
                seenItems.set(item.id, Date.now());
                return true;
            }
            return false;
        });
        
        console.log(`Found ${listings.length} total, ${newListings.length} new`);
        
        res.json({
            total: listings.length,
            new: newListings.length,
            listings: newListings,
            keyword
        });
        
    } catch (error) {
        console.error('Search error:', error.message);
        
        if (error.response?.status === 403 || error.response?.status === 429) {
            return res.status(503).json({ 
                error: 'Rate limited or blocked by Nellis Auction',
                suggestion: 'Try again in a few minutes'
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to fetch listings',
            details: error.message 
        });
    }
});

// Endpoint to check multiple keywords at once
app.post('/api/batch-search', async (req, res) => {
    const { keywords } = req.body;
    
    if (!Array.isArray(keywords) || keywords.length === 0) {
        return res.status(400).json({ error: 'Keywords array required' });
    }
    
    try {
        const results = await Promise.allSettled(
            keywords.map(async (keyword) => {
                const response = await axios.get(`https://nellisauction.com/search`, {
                    params: { query: keyword },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    },
                    timeout: 10000
                });
                
                const listings = parseNellisHTML(response.data);
                const newListings = listings.filter(item => {
                    const seen = seenItems.get(item.id);
                    if (!seen) {
                        seenItems.set(item.id, Date.now());
                        return true;
                    }
                    return false;
                });
                
                return {
                    keyword,
                    total: listings.length,
                    new: newListings.length,
                    listings: newListings
                };
            })
        );
        
        const successful = results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);
        
        const allNewListings = successful.flatMap(r => 
            r.listings.map(l => ({ ...l, matchedKeyword: r.keyword }))
        );
        
        res.json({
            results: successful,
            totalNew: allNewListings.length,
            newListings: allNewListings
        });
        
    } catch (error) {
        console.error('Batch search error:', error);
        res.status(500).json({ error: 'Batch search failed' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        itemsTracked: seenItems.size
    });
});

// Clean up old seen items every hour (keep last 7 days)
setInterval(() => {
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    for (const [id, timestamp] of seenItems.entries()) {
        if (timestamp < weekAgo) {
            seenItems.delete(id);
        }
    }
    console.log(`Cleanup: ${seenItems.size} items tracked`);
}, 60 * 60 * 1000);

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Nellis Monitor API running on port ${PORT}`);
    console.log(`📡 Search endpoint: http://localhost:${PORT}/api/search?keyword=monitor`);
});
