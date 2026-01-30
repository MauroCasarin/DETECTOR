
import React, { useState, useCallback } from 'react';
import { CameraFeed } from './components/CameraFeed';
import { Car, AlertTriangle, Video, VideoOff } from 'lucide-react';

const App: React.FC = () => {
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false);
  const [carCount, setCarCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleDetections = useCallback((count: number) => {
    setCarCount(count);
  }, []);

  const handleError = useCallback((message: string) => {
    setError(message);
    setIsCameraOn(false); // Turn off camera on error
  }, []);

  const toggleCamera = () => {
    if (isCameraOn) {
      setIsCameraOn(false);
      setCarCount(0);
    } else {
      setError(null);
      setIsCameraOn(true);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-4xl flex flex-col h-full">
        <header className="w-full bg-gray-800/50 backdrop-blur-sm p-4 rounded-xl mb-4 border border-gray-700 flex flex-col sm:flex-row justify-between items-center shadow-lg">
          <h1 className="text-2xl sm:text-3xl font-bold text-cyan-400 tracking-tight flex items-center">
            <Car className="w-8 h-8 mr-3" />
            Detector de Autos
          </h1>
          <div className="bg-gray-900/70 rounded-lg px-6 py-3 mt-3 sm:mt-0 flex items-center space-x-4">
            <span className="text-lg font-medium text-gray-300">Autos detectados:</span>
            <span className="text-4xl font-bold text-white transition-all duration-300">
              {carCount}
            </span>
          </div>
        </header>

        <main className="flex-grow flex flex-col items-center justify-center bg-black rounded-xl border border-gray-700 relative overflow-hidden shadow-2xl aspect-[9/16] sm:aspect-video">
          {isCameraOn ? (
            <CameraFeed
              onDetections={handleDetections}
              setLoading={setIsLoading}
              onError={handleError}
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8">
              <VideoOff className="w-24 h-24 text-gray-600 mb-6" />
              <h2 className="text-2xl font-semibold mb-2 text-gray-300">Cámara Desactivada</h2>
              <p className="text-gray-400 max-w-sm">
                Presiona el botón para iniciar la detección de autos en tiempo real usando la cámara trasera de tu dispositivo.
              </p>
            </div>
          )}
           {isLoading && isCameraOn && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-20">
              <div className="w-16 h-16 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
              <p className="mt-4 text-lg font-semibold">Analizando...</p>
            </div>
          )}
        </main>

        <footer className="w-full mt-4 flex flex-col items-center">
          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 p-3 rounded-lg mb-4 flex items-center w-full max-w-4xl">
              <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}
          <button
            onClick={toggleCamera}
            className={`px-8 py-4 rounded-full text-xl font-bold transition-all duration-300 flex items-center justify-center shadow-lg transform hover:scale-105 focus:outline-none focus:ring-4 ${
              isCameraOn
                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500/50 text-white'
                : 'bg-cyan-500 hover:bg-cyan-600 focus:ring-cyan-500/50 text-black'
            }`}
          >
            {isCameraOn ? (
              <>
                <VideoOff className="w-6 h-6 mr-3" />
                Detener Cámara
              </>
            ) : (
              <>
                <Video className="w-6 h-6 mr-3" />
                Iniciar Cámara
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default App;
