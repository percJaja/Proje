/*
================================================================================
--- BACKEND CODE (server.js) - ENHANCED AMAZON SCRAPING CONCEPT ---
================================================================================
Save this entire block as 'server.js' in your project folder.
This version outlines a more detailed Amazon scraping flow.
*/
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");
const axios = require('axios').default;
const { JSDOM } = require('jsdom');
const { CookieJar } = require('tough-cookie');
const { HttpsCookieAgent } = require('http-cookie-agent/http');
require('dotenv').config();

// --- App & Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'))); // For manifest.json and sw.js
app.use(express.json());

// --- In-memory Cache & Live State ---
const trackingCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10-minute cache
const liveUsers = new Map();
let amazonCookieJar = new CookieJar(); // Persistent cookie jar for Amazon session

// ===================================
//  REAL-TIME LIVE TRACKER LOGIC
// ===================================
io.on('connection', (socket) => {
    console.log(`[Socket.IO] User connected: ${socket.id}`);
    socket.emit('current_users', Array.from(liveUsers.values()));

    socket.on('join', (username) => {
        const userAvatar = `https://i.pravatar.cc/40?u=${socket.id}`;
        liveUsers.set(socket.id, { id: socket.id, username, avatar: userAvatar, latitude: null, longitude: null });
        socket.broadcast.emit('user_joined', liveUsers.get(socket.id)); // Notify others
        console.log(`[Socket.IO] User ${username} (${socket.id}) joined.`);
    });
    
    socket.on("send-location", (data) => {
        const userData = liveUsers.get(socket.id);
        if (userData) {
            userData.latitude = data.latitude;
            userData.longitude = data.longitude;
            socket.broadcast.emit("receive-location", { ...userData });
        }
    });

    socket.on('send_chat_message', (message) => {
        const sender = liveUsers.get(socket.id);
        io.emit('receive_chat_message', {
            user: sender || { username: 'Unknown', avatar: ''},
            message: message,
            timestamp: new Date()
        });
    });

    socket.on("disconnect", () => {
        console.log(`[Socket.IO] User disconnected: ${socket.id}`);
        if(liveUsers.has(socket.id)) {
            io.emit("user_disconnected", socket.id);
            liveUsers.delete(socket.id);
        }
    });
});

// ===================================
//  SERVER-SIDE TRACKING API
// ===================================
app.post('/api/track', async (req, res) => {
    let { trackingNumber } = req.body;
    if (!trackingNumber) {
        return res.status(400).json({ error: "Tracking number is required." });
    }

    let carrier = detectCarrier(trackingNumber);
    if (!carrier) {
        return res.status(400).json({ error: `Could not detect carrier for "${trackingNumber}".` });
    }

    const cacheKey = `${carrier}:${trackingNumber}`;
    if (trackingCache.has(cacheKey) && trackingCache.get(cacheKey).expiry > Date.now()) {
        console.log(`[API] Serving '${cacheKey}' from cache.`);
        return res.json(trackingCache.get(cacheKey).data);
    }
    
    console.log(`[API] Fetching fresh data for '${carrier}:${trackingNumber}'.`);
    try {
        let trackingData;
        if (carrier === 'amazon') {
            // The trackingNumber for Amazon is assumed to be the Order ID here.
            trackingData = await getAmazonTrackingWithLogin(trackingNumber);
        } else {
            trackingData = await getGenericTracking(carrier, trackingNumber);
        }
        
        trackingCache.set(cacheKey, { data: trackingData, expiry: Date.now() + CACHE_TTL });
        io.emit('tracking_update', { trackingNumber, carrier, ...trackingData}); // Real-time push
        res.json(trackingData);

    } catch (error) {
        console.error(`[API Error] for ${cacheKey}:`, error.message, error.stack);
        res.status(500).json({ error: error.message || 'An error occurred while tracking.' });
    }
});

// --- Root Route & Server Start ---
app.get('/', (req, res) => {
    res.render('index'); // This will render views/index.ejs
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Ultimate Tracker server is running on http://localhost:${PORT}`));

// ===================================
//  HELPER & SCRAPING FUNCTIONS
// ===================================
function detectCarrier(trackingNumber) {
    if (/^(1Z|1z)[A-Za-z0-9]{16}$/i.test(trackingNumber)) return 'ups';
    if (/^([0-9]{12}|[0-9]{15})$/.test(trackingNumber)) return 'fedex';
    if (/^[A-Za-z]{2}[0-9]{9}[A-Za-z]{2}$/i.test(trackingNumber)) return 'dhl'; // Example for DHL Express
    if (/^(9[2-5][0-9]{20,22})$/.test(trackingNumber)) return 'usps';
    if (/^[0-9A-Z]{3}-[0-9A-Z]{7}-[0-9A-Z]{7}$/i.test(trackingNumber)) return 'amazon'; // Amazon Order ID format
    return null;
}

async function getGenericTracking(carrier, trackingNumber){
    // ... (keep the existing getGenericTracking function as a fallback or for other carriers)
    console.log(`[Scraper] Simulating tracking for ${carrier}: ${trackingNumber}`);
    const delivered = Math.random() > 0.5;
    const now = new Date();
    
    const locations = ["Los Angeles, CA", "Denver, CO", "Chicago, IL", "New York, NY"];
    const geoCoords = {
        "Los Angeles, CA": { lat: 34.05, lon: -118.24 },
        "Denver, CO": { lat: 39.73, lon: -104.99 },
        "Chicago, IL": { lat: 41.87, lon: -87.62 },
        "New York, NY": { lat: 40.71, lon: -74.00 }
    }
    const finalLocation = locations[locations.length - 1];

    let activity = [
        { status: "Package received by carrier", location: locations[0], timestamp: new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString(), geo: geoCoords[locations[0]] },
        { status: "Departed from facility", location: locations[1], timestamp: new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString(), geo: geoCoords[locations[1]] },
        { status: "Arrived at destination hub", location: locations[2], timestamp: new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString(), geo: geoCoords[locations[2]] },
    ];

    if (delivered) {
        activity.push({ status: "Delivered", location: finalLocation, timestamp: now.toISOString(), geo: geoCoords[finalLocation] });
    } else {
        activity.push({ status: "Out for delivery", location: finalLocation, timestamp: now.toISOString(), geo: geoCoords[finalLocation] });
    }
    
    return {
        carrier: carrier.toUpperCase(),
        trackingNumber: trackingNumber,
        status: delivered ? 'Delivered' : 'In Transit',
        estimatedDelivery: delivered ? new Date().toLocaleDateString() : new Date(now.setDate(now.getDate() + 1)).toLocaleDateString(),
        activity: activity.reverse(),
    };
}

// --- More Robust Amazon Scraping (Conceptual Enhancement) ---
let amazonSessionActive = false;
async function ensureAmazonSession(client) {
    if (amazonSessionActive) {
        // Optionally, add a check here to see if the session is *still* valid (e.g., by trying a lightweight authenticated request)
        console.log('[Amazon Scraper] Reusing active Amazon session.');
        return true;
    }

    console.log('[Amazon Scraper] Attempting new Amazon login...');
    if (!process.env.AMZ_USER || !process.env.AMZ_PASS) {
        throw new Error("Amazon credentials (AMZ_USER, AMZ_PASS) not configured in .env file.");
    }

    try {
        // Step 1: Get initial sign-in page
        let response = await client.get('https://www.amazon.com/ap/signin', {
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } // Try to force fresh page
        });
        let dom = new JSDOM(response.data);
        let doc = dom.window.document;
        let form = doc.querySelector('form[name="signIn"]');
        
        if (!form) { // Sometimes Amazon presents a different initial page
            response = await client.get('https://www.amazon.com/gp/css/order-history');
            dom = new JSDOM(response.data);
            doc = dom.window.document;
            form = doc.querySelector('form[name="signIn"]');
            if (!form) throw new Error("Could not find Amazon login form (initial attempt).");
        }
        
        const extractHiddenInputs = (currentForm) => {
            const data = {};
            currentForm.querySelectorAll('input[type="hidden"]').forEach(input => {
                if (input.name) data[input.name] = input.value;
            });
            return data;
        };

        let formData = extractHiddenInputs(form);
        formData.email = process.env.AMZ_USER;
        formData.create = '0';
        
        console.log('[Amazon Scraper] Submitting email...');
        response = await client.post('https://www.amazon.com/ap/signin', new URLSearchParams(formData).toString());
        dom = new JSDOM(response.data);
        doc = dom.window.document;
        form = doc.querySelector('form[name="signIn"]');

        if (!form) { // Check if password page is directly presented or if there's an intermediate step
            if (response.data.includes("Enter your password")) { // Common scenario
                 // Fallthrough, form should be the password form
            } else if (response.data.includes("auth-mfa-otpcode")) {
                 throw new Error("Amazon MFA/OTP required. Automated login with OTP is complex and not implemented in this demo. Please resolve on Amazon's website.");
            } else if (response.data.includes("/errors/validateCaptcha")) {
                throw new Error("Amazon Captcha challenge. Please resolve on Amazon's website.");
            } else {
                console.error("Amazon login intermediate page content:", response.data.substring(0, 2000));
                throw new Error("Amazon login flow changed or encountered an unexpected page after email submission.");
            }
        }
        
        formData = extractHiddenInputs(form);
        formData.password = process.env.AMZ_PASS;
        formData.rememberMe = 'true'; // Optional: attempt to keep session longer

        console.log('[Amazon Scraper] Submitting password...');
        // Amazon often redirects after password submission, so allow redirects
        response = await client.post('https://www.amazon.com/ap/signin', new URLSearchParams(formData).toString(), { maxRedirects: 5 });

        // Verification: Check if login was successful by trying to access an authenticated page
        response = await client.get('https://www.amazon.com/gp/css/order-history');
        if (response.data.includes('redirectGet') || response.data.includes('/ap/signin')) {
            console.error("Amazon login verification failed. Content:", response.data.substring(0, 1000));
            amazonSessionActive = false;
            throw new Error("Amazon login failed. Check credentials or solve potential Captcha/MFA on Amazon's website.");
        }

        console.log('[Amazon Scraper] Amazon session established successfully.');
        amazonSessionActive = true;
        return true;

    } catch (error) {
        amazonSessionActive = false;
        console.error("[Amazon Scraper] Login Error:", error.message);
        if (error.response && error.response.status === 403) {
            console.error("[Amazon Scraper] Received 403 Forbidden. Possible IP block or bot detection.");
        }
        throw new Error(`Amazon login process failed: ${error.message}`);
    }
}

async function getAmazonTrackingWithLogin(orderId) {
    const client = axios.create({
        httpsAgent: new HttpsCookieAgent({ cookies: { jar: amazonCookieJar, sessionTimeout: 30 * 60 * 1000 } }), // Keep session for 30 mins
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*',
        }
    });

    await ensureAmazonSession(client); // This will login if needed and store cookies in amazonCookieJar

    console.log(`[Amazon Scraper] Fetching tracking for Order ID: ${orderId}`);
    const trackingUrl = `https://www.amazon.com/gp/your-account/order-details/ref=ppx_yo_dt_b_order_details?orderID=${orderId}`;
    const response = await client.get(trackingUrl);
    
    const dom = new JSDOM(response.data);
    const document = dom.window.document;

    // More robust scraping (example elements)
    let statusText = "Status not found";
    const statusElement = document.querySelector('.pt-status-main-status-text, span[data-testid="delivery-phase-text"], div[data-component="DeliveryTrackerStatus"] span:first-child');
    if(statusElement) statusText = statusElement.textContent.trim();
    
    let deliveryEstimate = "N/A";
    const estimateElement = document.querySelector('.pt-promise-main-slot .a-text-bold, span[data-testid="currentTrackingStatus-ExpectedDeliveryDate"]');
    if(estimateElement) deliveryEstimate = estimateElement.textContent.trim();
    
    const carrierInfoElement = document.querySelector('.pt-shipping-card-mover-name, div[data-component="ShipmentCarrier"] span:last-child');
    const carrierName = carrierInfoElement ? carrierInfoElement.textContent.trim() : "Amazon Logistics";

    const activity = [];
    // Try a few common selectors for tracking events
    const eventSelectors = [
        '.a-spacing-top-medium.pt-event-card', // Old selector
        'div[data-component="TrackingEventHistory"] div[data-component="TrackingEvent"]', // New selector pattern
        'div[id^="tracking-event-"]' // Another pattern
    ];

    let eventNodes = [];
    for (const selector of eventSelectors) {
        eventNodes = document.querySelectorAll(selector);
        if (eventNodes.length > 0) break;
    }

    eventNodes.forEach(eventCard => {
        let description = eventCard.querySelector('.pt-event-card-body-secondaryMessage, span[data-testid^="trackingEventMessage"], .a-row.a-spacing-small span:not([class])')?.textContent.trim() || 'Event details missing';
        let location = eventCard.querySelector('.pt-event-card-body-primaryMessage, span[data-testid^="trackingEventLocation"], .a-row.a-spacing-mini span[class=""]')?.textContent.trim() || '';
        let timestamp = eventCard.querySelector('.pt-event-card-body-tertiaryMessage, span[data-testid^="trackingEventTimestamp"], .a-row.a-size-small.a-color-secondary span')?.textContent.trim() || '';
        
        activity.push({
            status: location || description, // Often location gives context
            description: description,
            location: location,
            timestamp: timestamp,
            geo: geocodeLocation(location) // Conceptual geocoding
        });
    });
    
    if (activity.length === 0 && statusText === "Status not found") {
        // If no events and generic status, it might be a different page layout or error
        console.warn(`[Amazon Scraper] No specific tracking events found for ${orderId}. Full page content might be needed for debugging.`);
    }

    return {
        carrier: carrierName,
        trackingNumber: orderId,
        status: statusText,
        estimatedDelivery: deliveryEstimate,
        activity: activity.length > 0 ? activity.reverse() : [{ status: statusText, description: `Current status: ${statusText}`, location: '', timestamp: new Date().toISOString(), geo: null }],
    };
}

function geocodeLocation(locationString) {
    // This is a placeholder. A real implementation would use a geocoding API (Google Maps, Nominatim, etc.)
    // or a local database to convert location strings (e.g., "CITY, STATE") to lat/lon.
    if (!locationString) return null;
    if (locationString.toLowerCase().includes("los angeles")) return { lat: 34.05, lon: -118.24 };
    if (locationString.toLowerCase().includes("chicago")) return { lat: 41.87, lon: -87.62 };
    if (locationString.toLowerCase().includes("new york")) return { lat: 40.71, lon: -74.00 };
    if (locationString.toLowerCase().includes("memphis")) return { lat: 35.1495, lon: -90.0490 };
    return null;
}
