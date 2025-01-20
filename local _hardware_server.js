const express = require('express');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());

const serialPort = new SerialPort({
    path: 'COM7',
    baudRate: 115200
});

const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

// Create WebSocket server
const ws = new WebSocket('wss://your-codespace-url-8080.github.dev');

parser.on('data', (data) => {
    console.log('Raw data:', data);
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'serialData',
            data: data
        }));
    }
});

serialPort.on('error', (err) => {
    console.error('Serial Port Error:', err.message);
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Local hardware server running on port ${PORT}`);
});
