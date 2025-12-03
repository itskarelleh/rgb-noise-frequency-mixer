import React, { useState, useRef, useEffect } from 'react';
import { Volume2, VolumeX, Download, Play, Pause } from 'lucide-react';

export default function RGBNoiseMixer() {
  const [red, setRed] = useState(255);
  const [green, setGreen] = useState(255);
  const [blue, setBlue] = useState(255);
  const [isOrganic, setIsOrganic] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(10);

  const redRef = useRef(red);
  const greenRef = useRef(green);
  const blueRef = useRef(blue);
  const audioContextRef = useRef(null);
  const noiseNodeRef = useRef(null);
  const gainNodeRef = useRef(null);
  
  // Noise generation state for organic mode
  const organicStateRef = useRef({
    brownStates: [0, 0, 0],
    pinkStates: [
      { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 },
      { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 }
    ],
    lfoPhase: 0
  });

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

  const generateBrownNoiseSample = (state) => {
    const white = Math.random() * 2 - 1;
    const output = (state + (0.02 * white)) / 1.02;
    return output * 3.5;
  };

  const generatePinkNoiseSample = (state) => {
    const white = Math.random() * 2 - 1;
    state.b0 = 0.99886 * state.b0 + white * 0.0555179;
    state.b1 = 0.99332 * state.b1 + white * 0.0750759;
    state.b2 = 0.96900 * state.b2 + white * 0.1538520;
    state.b3 = 0.86650 * state.b3 + white * 0.3104856;
    state.b4 = 0.55000 * state.b4 + white * 0.5329522;
    state.b5 = -0.7616 * state.b5 - white * 0.0168980;
    const output = (state.b0 + state.b1 + state.b2 + state.b3 + state.b4 + state.b5 + state.b6 + white * 0.5362) * 0.11;
    state.b6 = white * 0.115926;
    return output;
  };

  const startRealTimeNoise = () => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = audioContext;

    const bufferSize = 4096;
    const scriptNode = audioContext.createScriptProcessor(bufferSize, 0, 2);
    
    scriptNode.onaudioprocess = (e) => {
      const outputL = e.outputBuffer.getChannelData(0);
      const outputR = e.outputBuffer.getChannelData(1);
       
      const bassGain = redRef.current / 255;
      const midGain = greenRef.current / 255;
      const trebleGain = blueRef.current / 255;
            
      if (!isOrganic) {
        // PURE MODE - Simple generation
        let brownState = 0;
        let pinkState = { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
        
        for (let i = 0; i < bufferSize; i++) {
          // Brown noise
          const white1 = Math.random() * 2 - 1;
          brownState = (brownState + (0.02 * white1)) / 1.02;
          const brown = brownState * 3.5;
          
          // Pink noise
          const pink = generatePinkNoiseSample(pinkState);
          
          // White noise
          const white = Math.random() * 2 - 1;
          
          const sample = (brown * bassGain * 0.4 + pink * midGain * 0.5 + white * trebleGain * 0.3) * 0.5;
          outputL[i] = sample;
          outputR[i] = sample;
        }
      } else {
        const state = organicStateRef.current;
        
        for (let i = 0; i < bufferSize; i++) {
          // Generate brown noise layers
          const brown1 = generateBrownNoiseSample(state.brownStates[0]);
          state.brownStates[0] = brown1 / 3.5;
          const brown2 = generateBrownNoiseSample(state.brownStates[1]);
          state.brownStates[1] = brown2 / 3.5;
          const brown3 = generateBrownNoiseSample(state.brownStates[2]);
          state.brownStates[2] = brown3 / 3.5;
          const brown = (brown1 * 0.4 + brown2 * 0.35 + brown3 * 0.25) * bassGain;
      
          // Pink noise layers
          const pink1 = generatePinkNoiseSample(state.pinkStates[0]);
          const pink2 = generatePinkNoiseSample(state.pinkStates[1]);
          const pink = (pink1 * 0.6 + pink2 * 0.4) * midGain;
      
          // White noise
          const white = (Math.random() * 2 - 1) * trebleGain;
      
          // LFO for organic movement
          state.lfoPhase += 0.00005;
          const lfo = Math.sin(2 * Math.PI * state.lfoPhase) * 0.15 + 1;
      
          const sample = (brown * 0.4 + pink * 0.5 + white * 0.3) * 0.5 * lfo;
      
          // Simple stereo panning: slow sinusoidal left/right
          const pan = Math.sin(2 * Math.PI * state.lfoPhase * 0.5) * 0.5 + 0.5; // 0 = left, 1 = right
          outputL[i] = sample * (1 - pan);
          outputR[i] = sample * pan;
      
          // Smoothing for organic feel
          if (i > 0) {
            outputL[i] = outputL[i] * 0.8 + outputL[i - 1] * 0.5;
            outputR[i] = outputR[i] * 0.8 + outputR[i - 1] * 0.5;
          }
        }
      }
    };

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.5;
    gainNodeRef.current = gainNode;

    scriptNode.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    noiseNodeRef.current = scriptNode;
    setIsPlaying(true);
  };

  const stopRealTimeNoise = () => {
    if (noiseNodeRef.current) {
      noiseNodeRef.current.disconnect();
      noiseNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsPlaying(false);
  };

  const togglePlayback = () => {
    if (isPlaying) {
      stopRealTimeNoise();
    } else {
      startRealTimeNoise();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRealTimeNoise();
    };
  }, []);

  const generateRecording = () => {
    const sampleRate = 44100;
    const length = sampleRate * duration;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = audioContext.createBuffer(2, length, sampleRate);
    
    const bassGain = red / 255;
    const midGain = green / 255;
    const trebleGain = blue / 255;
    
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = audioBuffer.getChannelData(1);
    
    if (!isOrganic) {
      let brownState = 0;
      let pinkState = { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
      
      for (let i = 0; i < length; i++) {
        const white1 = Math.random() * 2 - 1;
        brownState = (brownState + (0.02 * white1)) / 1.02;
        const brown = brownState * 3.5;
        
        const pink = generatePinkNoiseSample(pinkState);
        const white = Math.random() * 2 - 1;
        
        const sample = (brown * bassGain * 0.4 + pink * midGain * 0.5 + white * trebleGain * 0.3) * 0.5;
        leftChannel[i] = sample;
        rightChannel[i] = sample;
      }
    } else {
      const brownStates = [0, 0, 0];
      const pinkStates = [
        { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 },
        { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 }
      ];
      
      for (let i = 0; i < length; i++) {
        const brown1 = generateBrownNoiseSample(brownStates[0]);
        brownStates[0] = brown1 / 3.5;
        const brown2 = generateBrownNoiseSample(brownStates[1]);
        brownStates[1] = brown2 / 3.5;
        const brown3 = generateBrownNoiseSample(brownStates[2]);
        brownStates[2] = brown3 / 3.5;
        
        const brown = (brown1 * 0.4 + brown2 * 0.35 + brown3 * 0.25) * bassGain;
        
        const pink1 = generatePinkNoiseSample(pinkStates[0]);
        const pink2 = generatePinkNoiseSample(pinkStates[1]);
        const pink = (pink1 * 0.6 + pink2 * 0.4) * midGain;
        
        const white = (Math.random() * 2 - 1) * trebleGain;
        
        const lfo = Math.sin(2 * Math.PI * 2.5 * i / length) * 0.15 + 1;
        const sample = (brown * 0.4 + pink * 0.5 + white * 0.3) * 0.5 * lfo;
        
        leftChannel[i] = sample;
        rightChannel[i] = sample;
      }
    }
    
    return audioBuffer;
  };

  const handleDownload = () => {
    const audioBuffer = generateRecording();
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
    a.download = `custom-noise-rgb(${red},${green},${blue})-${isOrganic ? 'organic' : 'pure'}.wav`;
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
        <p className="text-gray-400 mb-6">Real-time noise synthesis • Adjust while playing</p>
        
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

        {/* Play/Stop Button */}
        <button
          onClick={togglePlayback}
          className={`w-full ${
            isPlaying ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
          } text-white font-semibold py-4 px-6 rounded-lg transition-colors mb-6 flex items-center justify-center gap-3 text-lg`}
        >
          {isPlaying ? (
            <>
              <VolumeX size={24} />
              Stop Real-Time Playback
            </>
          ) : (
            <>
              <Volume2 size={24} />
              Start Real-Time Playback
            </>
          )}
        </button>

        {isPlaying && (
          <div className="mb-6 p-3 bg-green-900 bg-opacity-30 border border-green-600 rounded-lg">
            <p className="text-green-400 text-sm text-center font-medium">
              🎵 Live! Adjust sliders to hear changes in real-time
            </p>
          </div>
        )}

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
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setRed(val);
                redRef.current = val; // <-- update ref
              }}
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
              onChange={(e) => 
                { 
                  const val = parseInt(e.target.value)
                  setGreen(val);
                  greenRef.current = val;
                }}
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
              onChange={(e) => { 
                  const val = parseInt(e.target.value)
                  setBlue(val);
                  blueRef.current = val;
                }}
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

        {/* Organic/Pure Toggle */}
        <div className="mb-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div>
              <label className="text-sm font-medium text-white">
                {isOrganic ? '🌿 Organic Mode' : '🔬 Pure Mode'}
              </label>
              <p className="text-xs text-gray-400 mt-1">
                {isOrganic 
                  ? 'Multi-layered with subtle movement and spatial depth' 
                  : 'Raw mathematical algorithms, perfectly static'}
              </p>
            </div>
            <button
              onClick={() => setIsOrganic(!isOrganic)}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                isOrganic ? 'bg-green-600' : 'bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  isOrganic ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Download Section */}
        <div className="border-t border-gray-700 pt-6">
          <label className="block text-sm font-medium text-gray-400 mb-3">
            Download Recording ({duration}s)
          </label>
          <input
            type="range"
            min="1"
            max="30"
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500 mb-4"
          />
          <button
            onClick={handleDownload}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Download size={20} />
            Download WAV File
          </button>
        </div>

        {/* Info */}
        <div className="mt-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
          <p className="text-sm text-gray-300 mb-2">
            <strong className="text-white">Real-time synthesis:</strong> Hit play and adjust the RGB sliders to hear instant changes!
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