const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Your existing parseSensorData function remains the same
function parseSensorData(data) {
    // Your existing parsing logic
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New WebSocket client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'serialData') {
                processSensorData(data.data);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.send(JSON.stringify({ 
        type: 'connection', 
        status: 'connected',
        message: 'Successfully connected to CardioTrack server'
    }));

    ws.on('error', console.error);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
