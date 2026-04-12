// Service Worker for Nellis Monitor PWA
// Enables background checks and notifications even when app is closed

const CACHE_NAME = 'nellis-monitor-v1';
const BACKGROUND_SYNC_TAG = 'nellis-check';

// Install Service Worker
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll([
                '/',
                '/nellis-monitor.html',
            ]);
        })
    );
    self.skipWaiting();
});

// Activate Service Worker
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('Service Worker: Clearing old cache');
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// Fetch event (cache-first strategy for offline support)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

// Background Sync - Check for new listings periodically
self.addEventListener('sync', (event) => {
    console.log('Service Worker: Background sync triggered', event.tag);
    
    if (event.tag === BACKGROUND_SYNC_TAG) {
        event.waitUntil(performBackgroundCheck());
    }
});

// Periodic Background Sync (supported on Chrome, limited on iOS)
self.addEventListener('periodicsync', (event) => {
    console.log('Service Worker: Periodic sync triggered', event.tag);
    
    if (event.tag === 'nellis-periodic-check') {
        event.waitUntil(performBackgroundCheck());
    }
});

// Perform the actual check
async function performBackgroundCheck() {
    try {
        // Get state from IndexedDB (since we can't access localStorage in SW)
        const state = await getStateFromIDB();
        
        if (!state || !state.notificationsEnabled || !state.keywords || state.keywords.length === 0) {
            console.log('Service Worker: Checks disabled or no keywords');
            return;
        }
        
        // Fetch new listings
        const API_URL = state.apiUrl || '';
        const response = await fetch(`${API_URL}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords: state.keywords })
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        const newListings = data.listings || [];
        
        // Filter truly new items
        const existingIds = new Set((state.recentMatches || []).map(m => m.id));
        const freshItems = newListings.filter(item => !existingIds.has(item.id));
        
        if (freshItems.length > 0) {
            // Show notification
            await self.registration.showNotification('🎯 New Nellis Matches!', {
                body: `${freshItems.length} new item${freshItems.length > 1 ? 's' : ''} found: ${freshItems[0].title}`,
                icon: '/icon-192.png',
                badge: '/badge-72.png',
                tag: 'nellis-match',
                data: { items: freshItems },
                vibrate: [200, 100, 200],
                requireInteraction: true,
                actions: [
                    { action: 'view', title: 'View Items' },
                    { action: 'dismiss', title: 'Dismiss' }
                ]
            });
            
            // Update state in IndexedDB
            await updateStateInIDB({
                ...state,
                totalMatches: (state.totalMatches || 0) + freshItems.length,
                totalChecks: (state.totalChecks || 0) + 1,
                lastCheck: new Date().toISOString(),
                recentMatches: [...freshItems, ...(state.recentMatches || [])].slice(0, 20)
            });
            
            // Notify all open clients
            const clients = await self.clients.matchAll();
            clients.forEach(client => {
                client.postMessage({
                    type: 'NEW_MATCHES',
                    matches: freshItems
                });
            });
        } else {
            // No new items, just update check count
            await updateStateInIDB({
                ...state,
                totalChecks: (state.totalChecks || 0) + 1,
                lastCheck: new Date().toISOString()
            });
        }
        
        console.log('Service Worker: Check complete', freshItems.length, 'new items');
        
    } catch (error) {
        console.error('Service Worker: Background check failed', error);
    }
}

// Notification click handler
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    if (event.action === 'view') {
        // Open the app
        event.waitUntil(
            self.clients.matchAll({ type: 'window' }).then((clients) => {
                // Check if app is already open
                for (let client of clients) {
                    if (client.url.includes('nellis-monitor') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Open new window
                if (self.clients.openWindow) {
                    return self.clients.openWindow('/');
                }
            })
        );
    }
});

// Push notification handler (for future server-sent notifications)
self.addEventListener('push', (event) => {
    console.log('Service Worker: Push received', event);
    
    let data = { title: 'Nellis Monitor', body: 'New update' };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }
    
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/icon-192.png',
            badge: '/badge-72.png',
            tag: 'nellis-push',
            vibrate: [200, 100, 200]
        })
    );
});

// IndexedDB helpers (Service Workers can't access localStorage)
async function getStateFromIDB() {
    return new Promise((resolve) => {
        const request = indexedDB.open('NellisMonitor', 1);
        
        request.onerror = () => resolve(null);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('state')) {
                db.createObjectStore('state');
            }
        };
        
        request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction(['state'], 'readonly');
            const store = transaction.objectStore('state');
            const getRequest = store.get('appState');
            
            getRequest.onsuccess = () => resolve(getRequest.result || null);
            getRequest.onerror = () => resolve(null);
        };
    });
}

async function updateStateInIDB(state) {
    return new Promise((resolve) => {
        const request = indexedDB.open('NellisMonitor', 1);
        
        request.onerror = () => resolve(false);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('state')) {
                db.createObjectStore('state');
            }
        };
        
        request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction(['state'], 'readwrite');
            const store = transaction.objectStore('state');
            const putRequest = store.put(state, 'appState');
            
            putRequest.onsuccess = () => resolve(true);
            putRequest.onerror = () => resolve(false);
        };
    });
}
