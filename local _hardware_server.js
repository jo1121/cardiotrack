const express = require('express');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// Configuration
const LOCAL_PORT = 3001;
const BASE_URL = 'https://legendary-broccoli-wrvqpjwxpqx635rgq-8080.app.github.dev';
const WEBSOCKET_URL = BASE_URL.replace('https://', 'wss://');

console.log('Base URL:', BASE_URL);
console.log('WebSocket URL:', WEBSOCKET_URL);

// Configure Serial Port
const serialPort = new SerialPort({
    path: 'COM7',
    baudRate: 115200
});

const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

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
        const apiEndpoint = `${BASE_URL}/api/vitals`;
        console.log('Sending data to:', apiEndpoint);
        console.log('Data being sent:', JSON.stringify(data, null, 2));
        
        const response = await axios.post(apiEndpoint, data, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });

        if (response.status === 201) {
            console.log('Data stored successfully');
            return true;
        } else {
            console.error('Unexpected response status:', response.status);
            return false;
        }
    } catch (error) {
        console.error('Failed to store data:');
        console.error('- Error message:', error.message);
        console.error('- Response status:', error.response?.status);
        console.error('- Response data:', error.response?.data);
        return false;
    }
}

function connectWebSocket() {
    console.log('Attempting to connect to:', WEBSOCKET_URL);
    
    const ws = new WebSocket(WEBSOCKET_URL, {
        rejectUnauthorized: false,
        headers: {
            'Origin': BASE_URL
        }
    });

    let reconnectTimer;
    let heartbeatInterval;

    ws.on('open', () => {
        console.log('Successfully connected to WebSocket server');
        
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }

        // Send initial device status
        const connectionMessage = {
            type: 'deviceStatus',
            status: 'connected',
            timestamp: new Date().toISOString()
        };
        ws.send(JSON.stringify(connectionMessage));

        // Setup heartbeat
        heartbeatInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
                ws.send(JSON.stringify({
                    type: 'deviceStatus',
                    status: 'connected',
                    timestamp: new Date().toISOString()
                }));
            }
        }, 15000);
    });

    ws.on('message', (data) => {
        console.log('Received message:', data.toString());
    });

    ws.on('close', (code, reason) => {
        console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
        clearInterval(heartbeatInterval);
        
        console.log('Attempting to reconnect in 5 seconds...');
        reconnectTimer = setTimeout(connectWebSocket, 5000);
    });

    ws.on('error', (error) => {
        console.error('WebSocket connection error:', error.message);
    });

    // Handle serial port data
    parser.on('data', (data) => {
        console.log('Raw data:', data);
        const parsedData = parseSensorData(data);
        
        if (parsedData) {
            if (ws.readyState === WebSocket.OPEN) {
                const message = {
                    type: 'vitalSigns',
                    data: parsedData
                };
                ws.send(JSON.stringify(message));
                console.log('Sent vital signs data');
            }

            storeDataInMongoDB(parsedData);
        }
    });

    return ws;
}

// Error handling for serial port
serialPort.on('error', (err) => {
    console.error('Serial port error:', err);
});

// Start the server and establish initial connection
app.listen(LOCAL_PORT, () => {
    console.log(`Local hardware server running on port ${LOCAL_PORT}`);
    
    // Test the main server connection first
    axios.get(BASE_URL)
        .then(() => {
            console.log('Main server is accessible');
            connectWebSocket();
        })
        .catch((error) => {
            console.error('Main server is not accessible:', error.message);
            console.log('Will attempt WebSocket connection anyway...');
            connectWebSocket();
        });
});

// Handle process termination
process.on('SIGTERM', () => {
    serialPort.close();
    console.log('Serial port closed');
    process.exit(0);
});
