#include <Wifi.h>
#include "MAX30105.h" // SparkFun MAX3010X library
#include "heartRate.h"

// Constants
#define TIMETOBOOT 3000  // Boot time in ms
#define SCALE      88.0  // Scale for graph plotting
#define SAMPLING   100   // Sampling interval
#define FINGER_ON  30000 // Finger detection threshold
#define USEFIFO
const byte RATE_SIZE = 4; // Heart rate averaging size

// Globals
MAX30105 particleSensor;
byte rates[RATE_SIZE] = {0};
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute = 0;
int beatAvg = 0;

double avered = 0, aveir = 0;
double sumirrms = 0, sumredrms = 0;
int i = 0, Num = 100;
float ESpO2 = 0; // Estimated SpO2
double FSpO2 = 0.7; // SpO2 filter factor
double frate = 0.95; // Low-pass filter factor for IR/red LED values

void setup() {
  Serial.begin(115200);
  Serial.println("\nInitializing...");

  // Initialize sensor
  while (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not found. Check wiring/power.");
    delay(1000);
  }

  // Configure sensor settings
  particleSensor.setup(
    0x7F,    // LED Brightness (0-255)
    4,       // Sample Average (1, 2, 4, 8, 16, 32)
    2,       // LED Mode (1 = Red only, 2 = Red + IR)
    200,     // Sample Rate (50-3200 Hz)
    411,     // Pulse Width (69-411 µs)
    16384    // ADC Range (2048-16384)
  );

  particleSensor.enableDIETEMPRDY();
  delay(TIMETOBOOT);
}

void loop() {
  long irValue = particleSensor.getIR();

  if (checkForBeat(irValue)) {
    processHeartBeat(irValue);
  }

  #ifdef USEFIFO
  processSensorData();
  #endif
}

void processHeartBeat(long irValue) {
  long delta = millis() - lastBeat;
  lastBeat = millis();

  beatsPerMinute = 60 / (delta / 1000.0);
  if (beatsPerMinute > 20 && beatsPerMinute < 255) {
    rates[rateSpot++] = (byte)beatsPerMinute;
    rateSpot %= RATE_SIZE;

    // Compute average heart rate
    beatAvg = 0;
    for (byte x = 0; x < RATE_SIZE; x++) {
      beatAvg += rates[x];
    }
    beatAvg /= RATE_SIZE;
  }
}

void processSensorData() {
  particleSensor.check();
  while (particleSensor.available()) {
    uint32_t ir = particleSensor.getFIFOIR();
    uint32_t red = particleSensor.getFIFORed();
    double fred = (double)red;
    double fir = (double)ir;

    avered = avered * frate + fred * (1.0 - frate);
    aveir = aveir * frate + fir * (1.0 - frate);
    sumredrms += (fred - avered) * (fred - avered);
    sumirrms += (fir - aveir) * (fir - aveir);

    if ((i++ % SAMPLING) == 0 && millis() > TIMETOBOOT) {
      logSensorData(ir, red, fred, fir);
    }

    if (i % Num == 0) {
      calculateSpO2();
    }

    particleSensor.nextSample();
  }
}

void logSensorData(uint32_t ir, uint32_t red, double fred, double fir) {
  if (ir < FINGER_ON) {
    Serial.println("No finger detected");
    return;
  }

  float ir_forGraph = scaleForGraph(fir, aveir);
  float red_forGraph = scaleForGraph(fred, avered);

  Serial.print("Red: ");
  Serial.print(red);
  Serial.print(", Infrared: ");
  Serial.println(ir);

  Serial.print("Oxygen % = ");
  Serial.print(ESpO2);
  Serial.print("%, BPM = ");
  Serial.print(beatsPerMinute);
  Serial.print(", Avg BPM = ");
  Serial.println(beatAvg);
}

float scaleForGraph(double value, double average) {
  float scaled = (2.0 * value - average) / average * SCALE;
  return constrain(scaled, 80.0, 100.0);
}

void calculateSpO2() {
  double R = (sqrt(sumredrms) / avered) / (sqrt(sumirrms) / aveir);
  double SpO2 = -3.11 * (R - 0.4) + 100;
  ESpO2 = FSpO2 * ESpO2 + (1.0 - FSpO2) * SpO2;

  sumredrms = 0.0;
  sumirrms = 0.0;
  i = 0;
}
