import { GoogleGenAI, Type } from "@google/genai";

// --- CONFIGURATION ---
const FRAME_PROCESSING_INTERVAL_MS = 1500; // How often to send a frame to the API
const GEMINI_MODEL = 'gemini-3-flash-preview';

// --- DOM ELEMENTS ---
const startView = document.getElementById('start-view') as HTMLDivElement;
const scannerView = document.getElementById('scanner-view') as HTMLDivElement;
const header = document.getElementById('header') as HTMLElement;
const startButton = document.getElementById('start-button') as HTMLButtonElement;
const loadingDiv = document.getElementById('loading') as HTMLDivElement;
const loadingText = document.getElementById('loading-text') as HTMLParagraphElement;
const startContent = document.getElementById('start-content') as HTMLDivElement;
const video = document.getElementById('video') as HTMLVideoElement;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const vehicleCountSpan = document.getElementById('vehicle-count') as HTMLSpanElement;
const ctx = canvas.getContext('2d');

// --- STATE ---
let isProcessing = false;
let lastVehicleCount = -1;
let detectionInterval: number | null = null;

// --- GEMINI INITIALIZATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

// --- SPEECH SERVICE ---
const speechService = {
    synth: window.speechSynthesis,
    voices: [] as SpeechSynthesisVoice[],
    speaker1: null as SpeechSynthesisVoice | null, // For detections
    speaker2: null as SpeechSynthesisVoice | null, // For system alerts
    loadVoices() {
        this.voices = this.synth.getVoices();
        if (this.voices.length > 0) {
            const esVoices = this.voices.filter(v => v.lang.startsWith('es'));
            this.speaker1 = esVoices.find(v => v.name.includes('Jorge') || v.name.includes('Google español')) || esVoices[0] || this.voices[0];
            this.speaker2 = esVoices.find(v => v.name.includes('Paulina') || v.name.includes('Mónica')) || (esVoices.length > 1 ? esVoices[1] : this.speaker1) || this.voices[1];
        }
    },
    speak(text: string, speakerType: 'detection' | 'system') {
        if (!this.synth || this.synth.speaking) return;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES';
        if (speakerType === 'detection' && this.speaker1) {
            utterance.voice = this.speaker1;
            utterance.rate = 1.1;
        } else if (speakerType === 'system' && this.speaker2) {
            utterance.voice = this.speaker2;
            utterance.rate = 1;
        }
        this.synth.speak(utterance);
    }
};
speechSynthesis.onvoiceschanged = () => speechService.loadVoices();
speechService.loadVoices();

// --- IMAGE & DETECTION LOGIC ---

/**
 * Captures a frame from the video, converts to base64, and sends to Gemini.
 */
async function processVideoFrame() {
    if (isProcessing || !video.srcObject || video.paused || video.ended) {
        return;
    }
    isProcessing = true;

    try {
        const frame = captureFrameAsBase64();
        if (!frame) return;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: {
                parts: [
                    {
                        inlineData: {
                            mimeType: 'image/jpeg',
                            data: frame,
                        },
                    },
                    {
                        text: `Detect all cars, trucks, and buses in this image. Provide ONLY a JSON array of bounding boxes.
                               Each box must be in the format [ymin, xmin, ymax, xmax] with normalized coordinates from 0.0 to 1.0.
                               If no vehicles are found, return an empty array [].`,
                    },
                ],
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.ARRAY,
                        items: { type: Type.NUMBER },
                    },
                },
            },
        });
        
        const jsonText = response.text.trim();
        const detections = JSON.parse(jsonText) as number[][];
        updateDetections(detections);

    } catch (error) {
        console.error("Error processing frame with Gemini:", error);
        speechService.speak("Error de conexión con la API.", "system");
    } finally {
        isProcessing = false;
    }
}

/**
 * Updates the UI with the latest detections from the API.
 * @param detections An array of bounding box coordinates.
 */
function updateDetections(detections: number[][]) {
    drawBoundingBoxes(detections);
    const currentCount = detections.length;
    vehicleCountSpan.textContent = String(currentCount);

    if (currentCount !== lastVehicleCount) {
        const vehicleWord = currentCount === 1 ? 'auto detectado' : 'autos detectados';
        speechService.speak(`${currentCount} ${vehicleWord}`, 'detection');
        lastVehicleCount = currentCount;
    }
}

/**
 * Draws bounding boxes on the canvas based on normalized coordinates.
 * @param boxes An array of [ymin, xmin, ymax, xmax] coordinates.
 */
function drawBoundingBoxes(boxes: number[][]) {
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    boxes.forEach(box => {
        if (box.length !== 4) return; // Ensure valid box format
        const [ymin, xmin, ymax, xmax] = box;
        const x = xmin * canvas.width;
        const y = ymin * canvas.height;
        const width = (xmax - xmin) * canvas.width;
        const height = (ymax - ymin) * canvas.height;

        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 4;
        ctx.fillStyle = 'rgba(6, 182, 212, 0.2)';
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.stroke();
        ctx.fill();
    });
}

/**
 * Captures a single frame from the video element onto a temporary canvas
 * and returns it as a base64 encoded JPEG string.
 */
function captureFrameAsBase64(): string | null {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;
    
    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.8);
    // Remove the data URL prefix to get the raw base64 string
    return dataUrl.split(',')[1];
}

// --- MAIN APP FLOW ---

/**
 * Initializes the camera and starts the detection loop.
 */
async function startScanner() {
    startContent.style.display = 'none';
    loadingDiv.style.display = 'block';

    try {
        loadingText.textContent = 'Iniciando cámara...';
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: "environment", 
                width: { ideal: 1280 }, 
                height: { ideal: 720 } 
            },
            audio: false // No need for microphone audio
        });

        video.srcObject = stream;
        await new Promise((resolve) => { video.onloadedmetadata = resolve; });
        await video.play();
        
        loadingText.textContent = 'Conectando con la API...';
        
        startView.style.display = 'none';
        scannerView.style.display = 'block';
        header.style.display = 'block';

        speechService.speak("Cámara iniciada", "system");

        // Start the detection loop
        detectionInterval = window.setInterval(processVideoFrame, FRAME_PROCESSING_INTERVAL_MS);
        
    } catch (err) {
        console.error("Error al iniciar:", err);
        const errorMessage = err instanceof Error ? err.message : "Error desconocido.";
        alert(`No se pudo iniciar. Verifica los permisos de la cámara. Error: ${errorMessage}`);
        startContent.style.display = 'block';
        loadingDiv.style.display = 'none';
    }
}

// --- EVENT LISTENERS ---
startButton.addEventListener('click', startScanner);
window.addEventListener('beforeunload', () => {
    if (detectionInterval) {
        clearInterval(detectionInterval);
    }
    const stream = video.srcObject as MediaStream;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
});
