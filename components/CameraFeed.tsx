
import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { BoundingBox } from '../types';
import { detectCarsInFrame } from '../services/geminiService';
import { speechService } from '../services/speechService';

interface CameraFeedProps {
  onDetections: (count: number) => void;
  setLoading: (loading: boolean) => void;
  onError: (message: string) => void;
}

export const CameraFeed: React.FC<CameraFeedProps> = ({ onDetections, setLoading, onError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isProcessing = useRef<boolean>(false);
  const lastDetectionCount = useRef<number>(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      speechService.speak("Cámara iniciada.", "alert");
    } catch (err) {
      console.error("Error accessing camera:", err);
      let message = "No se pudo acceder a la cámara. ";
      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          message += "Por favor, otorga permiso para usar la cámara.";
        } else if (err.name === "NotFoundError") {
          message += "No se encontró una cámara trasera en el dispositivo.";
        } else {
          message += `Detalle: ${err.message}`;
        }
      }
      onError(message);
    }
  }, [onError]);
  
  const drawBoundingBoxes = useCallback((boxes: BoundingBox[]) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    boxes.forEach(box => {
      const [ymin, xmin, ymax, xmax] = box;
      const x = xmin * canvas.width;
      const y = ymin * canvas.height;
      const width = (xmax - xmin) * canvas.width;
      const height = (ymax - ymin) * canvas.height;

      ctx.strokeStyle = '#06b6d4'; // cyan-500
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, width, height);
      ctx.fillStyle = 'rgba(6, 182, 212, 0.2)';
      ctx.fillRect(x, y, width, height);
    });
  }, []);

  const processVideoFrame = useCallback(async () => {
    if (isProcessing.current || !videoRef.current || !canvasRef.current || videoRef.current.paused || videoRef.current.ended) {
      requestAnimationFrame(() => processVideoFrame());
      return;
    }
    
    isProcessing.current = true;
    setLoading(true);

    const video = videoRef.current;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tempCtx = tempCanvas.getContext('2d');

    if (!tempCtx) {
      isProcessing.current = false;
      setLoading(false);
      requestAnimationFrame(() => processVideoFrame());
      return;
    }

    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
    const base64Image = tempCanvas.toDataURL('image/jpeg', 0.5).split(',')[1];

    try {
      const detections = await detectCarsInFrame(base64Image);
      drawBoundingBoxes(detections);
      onDetections(detections.length);

      if (detections.length !== lastDetectionCount.current) {
         if(detections.length > 0) {
            const carText = detections.length === 1 ? 'auto detectado' : 'autos detectados';
            speechService.speak(`${detections.length} ${carText}.`, "announcement");
         }
         lastDetectionCount.current = detections.length;
      }
    } catch (error) {
      console.error("Error from Gemini API:", error);
      speechService.speak("Error al procesar la imagen.", "alert");
      drawBoundingBoxes([]); // Clear boxes on error
      onDetections(0);
    } finally {
      setLoading(false);
      setTimeout(() => {
        isProcessing.current = false;
      }, 750); // Controls the processing rate (approx. 1.3 FPS)
      requestAnimationFrame(() => processVideoFrame());
    }
  }, [setLoading, onDetections, drawBoundingBoxes]);
  
  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  useEffect(() => {
    const videoElement = videoRef.current;
    let animationFrameId: number;

    const startProcessing = () => {
      animationFrameId = requestAnimationFrame(processVideoFrame);
    };

    if (stream && videoElement) {
      videoElement.onloadedmetadata = () => {
        videoElement.play().catch(e => console.error("Video play failed:", e));
      };
      videoElement.onplay = () => {
        startProcessing();
      };
    }
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [stream, processVideoFrame]);
  
  return (
    <div className="w-full h-full relative">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute top-0 left-0 w-full h-full object-cover"
      />
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full object-cover"
      />
    </div>
  );
};
