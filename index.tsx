import { GoogleGenAI, Type } from "@google/genai";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, onDisconnect, serverTimestamp } from "firebase/database";

// --- CONFIGURATION ---
const FRAME_PROCESSING_INTERVAL_MS = 750;
const GEMINI_MODEL = 'gemini-3-flash-preview';
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAmcm_RpfQRsdojq-jPkk_LvXeayGR5FlM",
    authDomain: "detector-autos.firebaseapp.com",
    databaseURL: "https://detector-autos-default-rdb.firebaseio.com",
    projectId: "detector-autos",
    storageBucket: "detector-autos.firebasestorage.app",
    messagingSenderId: "530080469828",
    appId: "1:530080469828:web:c2314bd12cd88e8b9cbd11"
};

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
const localVehicleCountSpan = document.getElementById('local-cars') as HTMLSpanElement;
const globalVehicleCountSpan = document.getElementById('global-cars') as HTMLSpanElement;
const globalDevicesSpan = document.getElementById('global-devices') as HTMLSpanElement;
const deviceListContainer = document.getElementById('device-list-container') as HTMLElement;
const deviceListUl = document.getElementById('device-list') as HTMLUListElement;
const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const ctx = canvas.getContext('2d');

// --- STATE ---
let isProcessing = false;
let lastLocalCount = -1;
let lastGlobalCount = -1;
let detectionInterval: number | null = null;
const deviceId = "Celular-" + Math.floor(Math.random() * 9000 + 1000);

// --- INITIALIZATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
const firebaseApp = !getApps().length ? initializeApp(FIREBASE_CONFIG) : getApp();
const db = getDatabase(firebaseApp);

// --- SPEECH SERVICE ---
const speechService = {
    synth: window.speechSynthesis,
    voices: [] as SpeechSynthesisVoice[],

    init(): Promise<void> {
        return new Promise((resolve) => {
            const loadVoices = () => {
                const spanishVoices = this.synth.getVoices().filter(v => v.lang.startsWith('es'));
                if (spanishVoices.length > 0) {
                    this.voices = spanishVoices;
                    resolve();
                }
            };
            if (this.synth.getVoices().length > 0) {
                loadVoices();
            } else {
                this.synth.onvoiceschanged = loadVoices;
            }
        });
    },

    speak(text: string, type: 'local' | 'global' | 'system' = 'system') {
        if (!this.synth || this.voices.length === 0) {
            console.warn("Speech synthesis no está disponible o no se encontraron voces en español.");
            return;
        }
        if (this.synth.speaking) {
            this.synth.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES';
        utterance.rate = 1.2;
        utterance.pitch = 1;

        switch (type) {
            case 'global':
                utterance.voice = this.voices.length > 1 ? this.voices[1] : this.voices[0];
                utterance.pitch = 0.9;
                break;
            case 'local':
                utterance.voice = this.voices[0];
                utterance.pitch = 1.1;
                break;
            case 'system':
            default:
                utterance.voice = this.voices[0];
                break;
        }
        
        this.synth.speak(utterance);
    }
};

// --- FIREBASE & NETWORK LOGIC ---
function setupFirebaseConnection() {
    const sessionRef = ref(db, 'sesiones/' + deviceId);
    onDisconnect(sessionRef).remove();
    set(sessionRef, {
        conteo: 0,
        nombre: deviceId,
        lastSeen: serverTimestamp()
    });
    syncNetworkState();
}

function syncNetworkState() {
    const sesionesRef = ref(db, 'sesiones');
    onValue(sesionesRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
             globalVehicleCountSpan.textContent = "0";
             globalDevicesSpan.textContent = "0";
             deviceListUl.innerHTML = '';
             return;
        };

        let totalAutos = 0;
        let totalCels = 0;
        let html = '';

        Object.keys(data).forEach(id => {
            totalAutos += data[id].conteo;
            totalCels++;
            const isMe = id === deviceId ? '(Tú)' : '';
            html += `<li class="flex justify-between border-b border-white/10 pb-1">
                <span class="${id === deviceId ? 'text-cyan-400 font-bold' : ''}">${data[id].nombre} ${isMe}</span>
                <span class="font-bold">${data[id].conteo} 🚗</span>
            </li>`;
        });

        if (lastGlobalCount !== -1 && totalAutos > lastGlobalCount) {
             speechService.speak(`Total en la red: ${totalAutos}`, 'global');
        }

        globalVehicleCountSpan.textContent = String(totalAutos);
        globalDevicesSpan.textContent = String(totalCels);
        deviceListUl.innerHTML = html;
        lastGlobalCount = totalAutos;
    });
}

// --- IMAGE & DETECTION LOGIC ---
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
                        inlineData: { mimeType: 'image/jpeg', data: frame },
                    },
                    {
                        text: `Detecta todos los autos, camiones y autobuses. Devuelve SOLO un array JSON de bounding boxes en formato [ymin, xmin, ymax, xmax] con coordenadas normalizadas. Si no hay vehículos, devuelve [].`,
                    },
                ],
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                },
            },
        });
        
        const jsonText = response.text.trim();
        const detections = JSON.parse(jsonText) as number[][];
        updateDetections(detections);

    } catch (error) {
        console.error("Error en Gemini:", error);
    } finally {
        isProcessing = false;
    }
}

function updateDetections(detections: number[][]) {
    drawBoundingBoxes(detections);
    const currentCount = detections.length;
    localVehicleCountSpan.textContent = String(currentCount);

    if (currentCount !== lastLocalCount) {
        if (lastLocalCount !== -1) { // Announce only after the first detection run
             speechService.speak(`${currentCount} vehículos detectados`, 'local');
        }
        set(ref(db, `sesiones/${deviceId}`), {
            conteo: currentCount,
            nombre: deviceId,
            lastSeen: serverTimestamp()
        });
        lastLocalCount = currentCount;
    }
}

function drawBoundingBoxes(boxes: number[][]) {
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    boxes.forEach(box => {
        if (box.length !== 4) return;
        const [ymin, xmin, ymax, xmax] = box;
        const x = xmin * canvas.width;
        const y = ymin * canvas.height;
        const width = (xmax - xmin) * canvas.width;
        const height = (ymax - ymin) * canvas.height;

        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.stroke();
    });
}

function captureFrameAsBase64(): string | null {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;
    
    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
    return tempCanvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

// --- MAIN APP FLOW ---
async function connectAndStart() {
    startContent.style.display = 'none';
    loadingDiv.style.display = 'block';

    try {
        loadingText.textContent = 'Iniciando voces...';
        await speechService.init();

        loadingText.textContent = 'Conectando a la red...';
        setupFirebaseConnection();
        statusDot.classList.replace('bg-red-500', 'bg-green-400');
        statusDot.classList.add('animate-pulse');
        statusText.textContent = 'Sincronizado';
        statusText.classList.replace('text-red-400', 'text-green-400');
        speechService.speak("Conectado a la red", 'system');

        loadingText.textContent = 'Iniciando cámara...';
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: "environment", 
                width: { ideal: 1280 }, 
                height: { ideal: 720 } 
            },
            audio: false
        });

        video.srcObject = stream;
        await new Promise((resolve) => { video.onloadedmetadata = resolve; });
        await video.play();
        
        startView.style.display = 'none';
        scannerView.style.display = 'block';
        header.style.display = 'block';
        deviceListContainer.style.display = 'block';
        setTimeout(() => deviceListContainer.style.opacity = '1', 100);

        detectionInterval = window.setInterval(processVideoFrame, FRAME_PROCESSING_INTERVAL_MS);
        
    } catch (err) {
        console.error("Error al iniciar:", err);
        const errorMessage = err instanceof Error ? err.message : "Error desconocido.";
        alert(`No se pudo iniciar. Verifica los permisos de la cámara. Error: ${errorMessage}`);
        startContent.style.display = 'block';
        loadingDiv.style.display = 'none';
        statusDot.classList.replace('bg-green-400', 'bg-red-500');
        statusDot.classList.remove('animate-pulse');
        statusText.textContent = 'Error';
        statusText.classList.replace('text-green-400', 'text-red-400');
    }
}

// --- EVENT LISTENERS ---
startButton.addEventListener('click', connectAndStart);
window.addEventListener('beforeunload', () => {
    if (detectionInterval) {
        clearInterval(detectionInterval);
    }
    const stream = video.srcObject as MediaStream;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    // Firebase onDisconnect handles cleanup
});