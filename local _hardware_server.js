const express = require('express');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// Update WebSocket URL to match your Codespace URL
const WEBSOCKET_URL = 'wss://legendary-broccoli-wrvqpjwxpqx635rgq-8080.app.github.dev';
const API_URL = WEBSOCKET_URL.replace('wss://', 'https://');

const serialPort = new SerialPort({
    path: 'COM7',
    baudRate: 115200
});

const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
const PORT = 3001;

// Function to parse sensor data
function parseSensorData(data) {
    try {
        if (data.includes("No finger detected")) {
            return null;
        }

        if (data.includes("Oxygen %")) {
            const matches = data.match(/Oxygen % = ([\d.]+)%, BPM = ([\d.]+), Avg BPM = ([\d.]+)/);
            if (matches) {
                const oxygen = parseFloat(matches[1]);
                const bpm = parseFloat(matches[2]);
                const avgBpm = parseFloat(matches[3]);
                
                const systolic = Math.min(140, Math.max(90, 100 + (avgBpm - 60) * 0.7));
                const diastolic = Math.min(90, Math.max(60, 70 + (avgBpm - 60) * 0.4));

                return {
                    oxygen: oxygen,
                    bloodPressure: {
                        systolic: systolic,
                        diastolic: diastolic
                    },
                    heartRate: bpm,
                    avgHeartRate: avgBpm,
                    timestamp: new Date().toISOString()
                };
            }
        }
        return null;
    } catch (error) {
        console.error('Error parsing sensor data:', error);
        return null;
    }
}

async function storeDataInMongoDB(data) {
    try {
        const apiEndpoint = `${API_URL}/api/vitals`;
        console.log('Attempting to store data in MongoDB');
        console.log('API URL:', apiEndpoint);
        console.log('Data being sent:', JSON.stringify(data, null, 2));

        const response = await axios.post(apiEndpoint, data, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });

        console.log('MongoDB storage response:', response.status, response.statusText);
        console.log('MongoDB response data:', response.data);
        return true;
    } catch (error) {
        console.error('MongoDB storage error details:');
        console.error('- Error message:', error.message);
        console.error('- Response status:', error.response?.status);
        console.error('- Response data:', error.response?.data);
        console.error('- Request URL:', error.config?.url);
        console.error('- Request data:', error.config?.data);
        return false;
    }
}

function connectWebSocket() {
    console.log('Attempting to connect to:', WEBSOCKET_URL);
    
    const ws = new WebSocket(WEBSOCKET_URL, {
        rejectUnauthorized: false,
        perMessageDeflate: false,
        handshakeTimeout: 15000
    });

    ws.on('open', () => {
        console.log('Connected to WebSocket server');
        const testMessage = {
            type: 'serialData',
            data: 'Connection Test'
        };
        ws.send(JSON.stringify(testMessage));
    });

    ws.on('message', (data) => {
        console.log('Received from WebSocket:', data.toString());
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    ws.on('close', (code, reason) => {
        console.log(`Connection closed with code ${code}. Reason: ${reason}`);
        console.log('Reconnecting in 5 seconds...');
        setTimeout(connectWebSocket, 5000);
    });

    // Handle serial port data
    parser.on('data', async (data) => {
        console.log('\n--- New Data Received ---');
        console.log('Raw data from serial port:', data);
        
        const parsedData = parseSensorData(data);
        
        if (parsedData) {
            // Send to WebSocket for real-time updates
            if (ws.readyState === WebSocket.OPEN) {
                const wsMessage = {
                    type: 'vitalSigns',
                    data: parsedData
                };
                console.log('Sending data via WebSocket:', JSON.stringify(wsMessage));
                ws.send(JSON.stringify(wsMessage));
            } else {
                console.log('WebSocket not ready. Current state:', ws.readyState);
            }

            // Store in MongoDB
            const stored = await storeDataInMongoDB(parsedData);
            if (stored) {
                console.log('Successfully stored data in MongoDB');
            } else {
                console.log('Failed to store data in MongoDB');
            }
        }
    });
}

// Error handling for serial port
serialPort.on('error', (err) => {
    console.error('Serial port error:', err);
});

// Initial connection
connectWebSocket();

// Start Express server
app.listen(PORT, () => {
    console.log(`Local hardware server running on port ${PORT}`);
    console.log('API endpoint:', `${API_URL}/api/vitals`);
});
