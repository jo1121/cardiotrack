const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');

// MongoDB connection
mongoose.connect('mongodb+srv://cardiotrack:cardiotrack_99@cluster0.2bb7l.mongodb.net/cardiotrack', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Define schema
const vitalSignsSchema = new mongoose.Schema({
    oxygen: Number,
    bloodPressure: {
        systolic: Number,
        diastolic: Number
    },
    heartRate: Number,
    avgHeartRate: Number,
    timestamp: { type: Date, default: Date.now }
});

const VitalSigns = mongoose.model('VitalSigns', vitalSignsSchema);

const app = express();

// CORS configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Device connection status
let deviceConnected = false;

// API Routes
app.post('/api/vitals', async (req, res) => {
    try {
        console.log('Received vital signs:', req.body);
        const vitalData = new VitalSigns(req.body);
        await vitalData.save();
        console.log('Data saved to MongoDB');
        res.status(201).json(vitalData);
    } catch (error) {
        console.error('Error saving vital signs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Device status endpoint
app.get('/api/device/status', (req, res) => {
    res.json({ connected: deviceConnected });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New WebSocket client connected');
    
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    // Send initial connection confirmation
    ws.send(JSON.stringify({ 
        type: 'connection', 
        status: 'connected',
        message: 'Successfully connected to CardioTrack server'
    }));

    // Handle incoming messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            console.log('Received WebSocket message:', message);

            if (message.type === 'deviceStatus') {
                deviceConnected = message.status === 'connected';
                // Broadcast device status to all clients
                wss.clients.forEach(client => {
                    if (client.readyState === 1) {
                        client.send(JSON.stringify({
                            type: 'deviceStatus',
                            connected: deviceConnected
                        }));
                    }
                });
            }

            if (message.type === 'vitalSigns') {
                // Broadcast vital signs to all clients
                wss.clients.forEach(client => {
                    if (client.readyState === 1) {
                        client.send(data.toString());
                    }
                });
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', console.error);
});

// Implement WebSocket heartbeat
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            deviceConnected = false;
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    const CODESPACE_NAME = process.env.CODESPACE_NAME;
    const publicUrl = CODESPACE_NAME 
        ? `https://${CODESPACE_NAME}-${PORT}.app.github.dev`
        : `http://localhost:${PORT}`;
    console.log(`Server running on port ${PORT}`);
    console.log(`Access the dashboard at ${publicUrl}`);
});
app.get('/api/admin/vitals/download', async (req, res) => {
    try {
        // Get all vital signs data without pagination
        const vitals = await VitalSigns
            .find({})
            .sort({ timestamp: -1 });

        // Set headers for file download
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=vital_signs_data.json');
        
        // Send the data
        res.json(vitals);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});