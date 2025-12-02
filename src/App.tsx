import React, { useState, useRef, useEffect } from 'react';
import { Volume2, Download, RotateCcw } from 'lucide-react';

export default function App() {
  const [red, setRed] = useState(255);
  const [green, setGreen] = useState(255);
  const [blue, setBlue] = useState(255);
  const [duration, setDuration] = useState(10);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef(null);
  const audioBufferRef = useRef(null);
  const sourceNodeRef = useRef(null);

  const rgbToHex = (r, g, b) => {
    return '#' + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  };

  const getNoiseDescription = () => {
    const total = red + green + blue;
    const rPct = (red / total) * 100;
    const bPct = (blue / total) * 100;
    
    if (red > 250 && green > 250 && blue > 250) return "White Noise";
    if (red < 50 && green < 50 && blue < 50) return "Near Silence";
    if (rPct > 50 && bPct < 25) return "Brown-ish Noise";
    if (rPct > 40 && bPct < 35) return "Pink-ish Noise";
    if (bPct > 50) return "Blue-ish Noise";
    return "Custom Noise";
  };

  const generateCustomNoise = (length, bassGain, midGain, trebleGain) => {
    const buffer = new Float32Array(length);
    
    // Generate brown noise (Brownian motion for bass)
    const brownNoise = new Float32Array(length);
    let lastOut = 0.0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      brownNoise[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = brownNoise[i];
      brownNoise[i] *= 3.5;
    }
    
    // Generate pink noise (for mids)
    const pinkNoise = new Float32Array(length);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      pinkNoise[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    
    // Generate white noise (for treble)
    const whiteNoise = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      whiteNoise[i] = Math.random() * 2 - 1;
    }
    
    // Mix the three noise types based on RGB values
    for (let i = 0; i < length; i++) {
      buffer[i] = (
        brownNoise[i] * bassGain * 0.4 +
        pinkNoise[i] * midGain * 0.5 +
        whiteNoise[i] * trebleGain * 0.3
      ) * 0.5;
    }
    
    return buffer;
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    
    setTimeout(() => {
      const sampleRate = 44100;
      const length = sampleRate * duration;
      
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      
      // Map RGB to frequency gains
      const bassGain = red / 255;
      const midGain = green / 255;
      const trebleGain = blue / 255;
      
      const audioBuffer = audioContext.createBuffer(2, length, sampleRate);
      const leftChannel = generateCustomNoise(length, bassGain, midGain, trebleGain);
      const rightChannel = generateCustomNoise(length, bassGain, midGain, trebleGain);
      
      audioBuffer.getChannelData(0).set(leftChannel);
      audioBuffer.getChannelData(1).set(rightChannel);
      
      audioBufferRef.current = audioBuffer;
      setIsGenerating(false);
    }, 100);
  };

  const handlePlay = () => {
    if (!audioBufferRef.current || !audioContextRef.current) return;
    
    // Stop existing playback
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
    }
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBufferRef.current;
    source.connect(audioContextRef.current.destination);
    source.onended = () => setIsPlaying(false);
    source.start(0);
    sourceNodeRef.current = source;
    setIsPlaying(true);
  };

  const handleStop = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      setIsPlaying(false);
    }
  };

  const handleDownload = () => {
    if (!audioBufferRef.current) return;
    
    const audioBuffer = audioBufferRef.current;
    const channels = [audioBuffer.getChannelData(0), audioBuffer.getChannelData(1)];
    const length = audioBuffer.length * channels.length * 2;
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);
    
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, audioBuffer.sampleRate, true);
    view.setUint32(28, audioBuffer.sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length, true);
    
    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < 2; channel++) {
        const sample = Math.max(-1, Math.min(1, channels[channel][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom-noise-rgb(${red},${green},${blue}).wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const setPreset = (r, g, b) => {
    setRed(r);
    setGreen(g);
    setBlue(b);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 p-8 flex items-center justify-center">
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 max-w-2xl w-full border border-gray-700">
        <h1 className="text-3xl font-bold text-white mb-2">RGB Noise Frequency Mixer</h1>
        <p className="text-gray-400 mb-6">Paint your noise with color • Generate custom frequencies</p>
        
        {/* Color Display */}
        <div className="mb-6 relative">
          <div 
            className="w-full h-32 rounded-lg shadow-lg transition-colors duration-300"
            style={{ backgroundColor: rgbToHex(red, green, blue) }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-black bg-opacity-50 px-4 py-2 rounded-lg">
              <p className="text-white font-mono text-lg">RGB({red}, {green}, {blue})</p>
              <p className="text-gray-300 text-sm text-center mt-1">{getNoiseDescription()}</p>
            </div>
          </div>
        </div>

        {/* RGB Sliders */}
        <div className="space-y-4 mb-6">
          <div>
            <div className="flex justify-between mb-2">
              <label className="text-sm font-medium text-red-400">Red (Bass) • {red}</label>
              <span className="text-xs text-gray-500">20Hz - 200Hz</span>
            </div>
            <input
              type="range"
              min="0"
              max="255"
              value={red}
              onChange={(e) => setRed(parseInt(e.target.value))}
              className="w-full h-3 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
            />
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <label className="text-sm font-medium text-green-400">Green (Mids) • {green}</label>
              <span className="text-xs text-gray-500">200Hz - 2kHz</span>
            </div>
            <input
              type="range"
              min="0"
              max="255"
              value={green}
              onChange={(e) => setGreen(parseInt(e.target.value))}
              className="w-full h-3 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
            />
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <label className="text-sm font-medium text-blue-400">Blue (Treble) • {blue}</label>
              <span className="text-xs text-gray-500">2kHz - 20kHz</span>
            </div>
            <input
              type="range"
              min="0"
              max="255"
              value={blue}
              onChange={(e) => setBlue(parseInt(e.target.value))}
              className="w-full h-3 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </div>

        {/* Presets */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-400 mb-3">Quick Presets</label>
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => setPreset(255, 255, 255)}
              className="bg-gray-100 hover:bg-white text-gray-800 py-2 px-3 rounded-lg text-sm font-medium transition-colors"
            >
              White
            </button>
            <button
              onClick={() => setPreset(255, 200, 150)}
              className="bg-pink-400 hover:bg-pink-500 text-white py-2 px-3 rounded-lg text-sm font-medium transition-colors"
            >
              Pink
            </button>
            <button
              onClick={() => setPreset(255, 100, 50)}
              className="bg-amber-700 hover:bg-amber-800 text-white py-2 px-3 rounded-lg text-sm font-medium transition-colors"
            >
              Brown
            </button>
            <button
              onClick={() => setPreset(150, 200, 255)}
              className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-3 rounded-lg text-sm font-medium transition-colors"
            >
              Blue
            </button>
          </div>
        </div>

        {/* Duration */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Duration: {duration} seconds
          </label>
          <input
            type="range"
            min="1"
            max="30"
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors mb-4"
        >
          {isGenerating ? 'Generating...' : 'Generate Custom Noise'}
        </button>

        {/* Playback Controls */}
        {audioBufferRef.current && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={isPlaying ? handleStop : handlePlay}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Volume2 size={20} />
              {isPlaying ? 'Stop' : 'Play'}
            </button>
            
            <button
              onClick={handleDownload}
              className="bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Download size={20} />
              Download
            </button>
          </div>
        )}

        {/* Info */}
        <div className="mt-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
          <p className="text-sm text-gray-300 mb-2">
            <strong className="text-white">How it works:</strong> Just like RGB creates colors, this mixes frequencies to create noise.
          </p>
          <ul className="text-xs text-gray-400 space-y-1">
            <li><span className="text-red-400">Red</span> = Bass frequencies (deep rumble)</li>
            <li><span className="text-green-400">Green</span> = Mid frequencies (body/presence)</li>
            <li><span className="text-blue-400">Blue</span> = Treble frequencies (brightness/hiss)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
