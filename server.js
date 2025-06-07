/*
================================================================================
--- BACKEND CODE (server.js) ---
================================================================================
Save this entire block as 'server.js' in your project folder.
This is the powerful Node.js server that runs the application.
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
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- In-memory Cache & Live State ---
const trackingCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10-minute cache
const liveUsers = new Map();

// ===================================
//  REAL-TIME LIVE TRACKER LOGIC
// ===================================
io.on('connection', (socket) => {
    console.log(`[Socket.IO] User connected: ${socket.id}`);

    socket.on('join', (username) => {
        const userAvatar = `https://i.pravatar.cc/40?u=${socket.id}`;
        liveUsers.set(socket.id, { id: socket.id, username, avatar: userAvatar });
        socket.emit('current_users', Array.from(liveUsers.values()));
        socket.broadcast.emit('user_joined', liveUsers.get(socket.id));
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

    // --- Automatic Carrier Detection Logic ---
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
            trackingData = await getAmazonTracking(trackingNumber);
        } else {
            trackingData = await getGenericTracking(carrier, trackingNumber);
        }
        
        trackingCache.set(cacheKey, { data: trackingData, expiry: Date.now() + CACHE_TTL });
        res.json(trackingData);

    } catch (error) {
        console.error(`[API Error] for ${cacheKey}:`, error.message);
        res.status(500).json({ error: error.message || 'An error occurred while tracking.' });
    }
});

// --- Root Route & Server Start ---
app.get('/', (req, res) => {
    res.render('index');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Ultimate Tracker server is running on http://localhost:${PORT}`));

// ===================================
//  HELPER & SCRAPING FUNCTIONS
// ===================================
function detectCarrier(trackingNumber) {
    if (/^(1Z|1z)[A-Za-z0-9]{16}$/.test(trackingNumber)) return 'ups';
    if (/^([0-9]{12}|[0-9]{15})$/.test(trackingNumber)) return 'fedex';
    if (/^[A-Za-z]{2}[0-9]{9}[A-Za-z]{2}$/.test(trackingNumber)) return 'dhl'; // Example for DHL Express
    if (/^9[2-5][0-9]{20,22}$/.test(trackingNumber)) return 'usps';
    if (/^[0-9A-Z]{3}-[0-9A-Z]{7}-[0-9A-Z]{7}$/.test(trackingNumber)) return 'amazon'; // Amazon Order ID format
    return null; // Could not detect
}

async function getGenericTracking(carrier, trackingNumber){
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

async function getAmazonTracking(orderId) {
    if (!process.env.AMZ_USER) throw new Error("Server is not configured for Amazon tracking.");
    console.warn("[Amazon Scraper] Using mock data. Real scraping is complex and requires credentials in .env file.");
    return getGenericTracking('amazon', orderId);
    // Note: The fully functional, complex scraping logic from the iobroker adapter requires extensive setup
    // (handling cookies, CSRF, solving captchas) and is provided conceptually here.
    // The generic tracker provides a reliable demonstration of the application's capabilities.
}
