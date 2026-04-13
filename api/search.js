const $ = cheerio.load(response.data);

// Nellis loads items dynamically, but some HTML is server-rendered
// Look for any element containing price/title/link patterns
const listings = [];

// Try to find item containers - look for patterns in the HTML
$('a[href*="/item/"]').each((i, elem) => {
  try {
    const $link = $(elem);
    const href = $link.attr('href');
    const itemId = href.match(/\/item\/(\d+)/)?.[1];
    
    if (!itemId) return;
    
    // Get the parent container that has all the item info
    const $container = $link.closest('div, article, section, li').first();
    
    // Extract text from the container
    const allText = $container.text();
    const title = allText.substring(0, 200).trim(); // First 200 chars as title
    
    // Look for price patterns in text
    const priceMatch = allText.match(/\$\d+(?:\.\d{2})?/);
    const price = priceMatch ? priceMatch[0] : 'See listing';
    
    if (title.length > 10) {
      listings.push({
        id: itemId,
        title: title.replace(/\s+/g, ' '),
        price,
        url: `https://nellisauction.com${href}`,
        matchedKeyword: keyword,
        timestamp: new Date().toISOString()
      });
    }
  } catch (err) {
    // Skip this item
  }
});

allListings.push(...listings);
