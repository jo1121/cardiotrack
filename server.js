const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ 
    noServer: true,
    clientTracking: true 
});

// Handle upgrade manually
server.on('upgrade', (request, socket, head) => {
    console.log('Received upgrade request');
    wss.handleUpgrade(request, socket, head, (ws) => {
        console.log('WebSocket connection established');
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received data:', data);
            if (data.type === 'serialData') {
                console.log('Sensor data:', data.data);
                // Broadcast to all clients
                wss.clients.forEach(client => {
                    if (client.readyState === 1) {
                        client.send(JSON.stringify(data));
                    }
                });
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    const CODESPACE_NAME = process.env.CODESPACE_NAME;
    const publicUrl = CODESPACE_NAME 
        ? `https://${CODESPACE_NAME}-${PORT}.app.github.dev`
        : `http://localhost:${PORT}`;
    console.log(`Server running on port ${PORT}`);
    console.log(`Public URL: ${publicUrl}`);
    console.log(`WebSocket URL: ${publicUrl.replace('https://', 'wss://')}`);
});