import React, { useState, useRef, useEffect } from 'react';
import { Volume2, VolumeX, Download, Plus, Trash2 } from 'lucide-react';

interface Preset {
  id: string;
  name: string;
  red: number;
  green: number;
  blue: number;
  isOrganic: boolean;
  lfoRate: number;
  lfoDepth: number;
  lfoShape: string;
  randomness: number;
  phaseOffset: number;
}

export default function RGBNoiseMixer() {
  // --- Core states (visible UI) ---
  const [red, setRed] = useState(255);
  const [green, setGreen] = useState(255);
  const [blue, setBlue] = useState(255);
  const [isOrganic, setIsOrganic] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(10);

  // --- Organic control states (visible UI) ---
  const [lfoRate, setLfoRate] = useState(1 / 8); // Hz (default 0.125)
  const [lfoDepth, setLfoDepth] = useState(0.9); // 0..1 pan depth
  const [lfoShape, setLfoShape] = useState('sine'); // 'sine' | 'triangle' | 'smoothstep' | 'noiseBlend'
  const [randomness, setRandomness] = useState(0.03); // 0..0.2
  const [phaseOffset, setPhaseOffset] = useState(0); // 0..1 (0..360deg)

  // --- Custom presets ---
  const [presets, setPresets] = useState<Preset[]>([]);
  const [hoveredPresetId, setHoveredPresetId] = useState<string | null>(null);

  // --- Refs for live audio access (so changes apply instantly) ---
  const redRef = useRef(red);
  const greenRef = useRef(green);
  const blueRef = useRef(blue);
  const isOrganicRef = useRef(isOrganic);

  const lfoRateRef = useRef(lfoRate);
  const lfoDepthRef = useRef(lfoDepth);
  const lfoShapeRef = useRef(lfoShape);
  const randomnessRef = useRef(randomness);
  const phaseOffsetRef = useRef(phaseOffset);

  // audio nodes & state
  const audioContextRef = useRef(null);
  const noiseNodeRef = useRef(null);
  const gainNodeRef = useRef(null);

  // organic internal generator state
  const organicStateRef = useRef({
    brownStates: [0, 0, 0],
    pinkStates: [
      { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 },
      { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 }
    ],
    lfoPhase: 0 // radians
  });

  // --- Helpers ---
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

  // Brown noise helper
  const generateBrownNoiseSample = (stateVal) => {
    const white = Math.random() * 2 - 1;
    const output = (stateVal + (0.02 * white)) / 1.02;
    return output * 3.5;
  };

  // Pink noise helper (7-coef method)
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

  // LFO shape helpers: input x in [-1,1] → shaped value in [-1,1]
  const shapeLFO = (raw, shape) => {
    if (shape === 'sine') return raw; // already [-1..1]
    if (shape === 'triangle') return 2 * Math.asin(Math.sin(raw)) / Math.PI; // approximate triangle
    if (shape === 'smoothstep') {
      // convert [-1..1] -> [0..1], smoothstep, back to [-1..1]
      const t = (raw + 1) * 0.5;
      const s = t * t * (3 - 2 * t);
      return s * 2 - 1;
    }
    if (shape === 'noiseBlend') {
      // base sine blended with high-rate micro-noise
      const noise = (Math.random() * 2 - 1) * 0.2;
      return raw * 0.85 + noise * 0.15;
    }
    return raw;
  };

  // --- Real-time playback (start/stop) ---
  const startRealTimeNoise = () => {
    if (audioContextRef.current) return; // already running
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = audioContext;

    const bufferSize = 4096;
    const scriptNode = audioContext.createScriptProcessor(bufferSize, 0, 2);

    // ensure lfoPhase initialized from phaseOffset (phaseOffset is 0..1)
    organicStateRef.current.lfoPhase = phaseOffsetRef.current * Math.PI * 2;

    scriptNode.onaudioprocess = (e) => {
      const outputL = e.outputBuffer.getChannelData(0);
      const outputR = e.outputBuffer.getChannelData(1);

      const sampleRate = audioContext.sampleRate;

      // read live gains from refs
      const bassGain = redRef.current / 255;
      const midGain = greenRef.current / 255;
      const trebleGain = blueRef.current / 255;

      // copy local refs for organic settings (these can be adjusted live)
      const localLfoRate = lfoRateRef.current;      // Hz
      const localLfoDepth = lfoDepthRef.current;    // 0..1
      const localLfoShape = lfoShapeRef.current;
      const localRand = randomnessRef.current;      // 0..0.2
      const localPhaseOffset = phaseOffsetRef.current;

      if (!isOrganicRef.current) {
        // PURE MODE: simple per-buffer generator (deterministic-ish)
        let brownState = 0;
        let pinkState = { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };

        for (let i = 0; i < bufferSize; i++) {
          const white1 = Math.random() * 2 - 1;
          brownState = (brownState + (0.02 * white1)) / 1.02;
          const brown = brownState * 3.5;

          const pink = generatePinkNoiseSample(pinkState);
          const white = Math.random() * 2 - 1;

          const sample = (brown * bassGain * 0.4 + pink * midGain * 0.5 + white * trebleGain * 0.3) * 0.5;

          // simple static center pan in pure mode
          outputL[i] = sample;
          outputR[i] = sample;
        }
      } else {
        // ORGANIC MODE
        const state = organicStateRef.current;

        // We'll update phase increment per-sample for sample-accurate LFO:
        // phase increment = 2*pi*freq / sampleRate
        const phaseInc = (2 * Math.PI * localLfoRate) / sampleRate;

        for (let i = 0; i < bufferSize; i++) {
          // brown layers
          const brown1 = generateBrownNoiseSample(state.brownStates[0]);
          state.brownStates[0] = brown1 / 3.5;
          const brown2 = generateBrownNoiseSample(state.brownStates[1]);
          state.brownStates[1] = brown2 / 3.5;
          const brown3 = generateBrownNoiseSample(state.brownStates[2]);
          state.brownStates[2] = brown3 / 3.5;
          const brown = (brown1 * 0.4 + brown2 * 0.35 + brown3 * 0.25) * bassGain;

          // pink layers
          const pink1 = generatePinkNoiseSample(state.pinkStates[0]);
          const pink2 = generatePinkNoiseSample(state.pinkStates[1]);
          const pink = (pink1 * 0.6 + pink2 * 0.4) * midGain;

          // white
          const white = (Math.random() * 2 - 1) * trebleGain;

          // advance LFO phase
          state.lfoPhase += phaseInc;

          // raw LFO in [-1..1]
          const raw = Math.sin(state.lfoPhase);
          // shaped LFO
          const shaped = shapeLFO(raw, localLfoShape);

          // micro-randomness (very small jitter in amplitude & pan)
          const jitter = (Math.random() - 0.5) * 2 * localRand; // -rand..+rand

          // final LFO value used for amplitude modulation (breathing) and pan center
          // amplitude modulation between ~(1 - depth*0.4) and ~(1 + depth*0.4)
          const ampLfo = 1 + (shaped * 0.15) + jitter * 0.05;

          // panning value: center ± depth. Convert shaped [-1..1] to pan [0..1]
          const panNormalized = (shaped * 0.5 * localLfoDepth) + 0.5 + jitter * 0.01; // 0=left,1=right
          const pan = Math.max(0, Math.min(1, panNormalized)); // clamp

          // base sample
          const sample = (brown * 0.4 + pink * 0.5 + white * 0.3) * 0.5 * ampLfo;

          // simple equal-power-ish pan:
          // leftGain = cos(pan * PI/2), rightGain = sin(pan * PI/2)
          const leftGain = Math.cos(pan * Math.PI * 0.5);
          const rightGain = Math.sin(pan * Math.PI * 0.5);

          outputL[i] = sample * leftGain;
          outputR[i] = sample * rightGain;

          // smoothing (very mild) to reduce per-sample micro-stepping
          if (i > 0) {
            outputL[i] = outputL[i] * 0.85 + outputL[i - 1] * 0.15;
            outputR[i] = outputR[i] * 0.85 + outputR[i - 1] * 0.15;
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
      try { noiseNodeRef.current.disconnect(); } catch(e) {}
      noiseNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      try { gainNodeRef.current.disconnect(); } catch(e) {}
      gainNodeRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch(e) {}
      audioContextRef.current = null;
    }
    setIsPlaying(false);
  };

  const togglePlayback = () => {
    if (isPlaying) stopRealTimeNoise();
    else startRealTimeNoise();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRealTimeNoise();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Recording generation (respects organic settings from state) ---
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
      // For recording, use the same organic algorithm but based on state variables (not refs)
      const brownStates = [0, 0, 0];
      const pinkStates = [
        { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 },
        { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 }
      ];
      let lfoPhaseRec = phaseOffset * Math.PI * 2;
      const phaseIncRec = (2 * Math.PI * lfoRate) / sampleRate;

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

        lfoPhaseRec += phaseIncRec;
        const raw = Math.sin(lfoPhaseRec);
        const shaped = shapeLFO(raw, lfoShape);
        const jitter = (Math.random() - 0.5) * 2 * randomness;
        const ampLfo = 1 + (shaped * 0.15) + jitter * 0.05;
        const panNormalized = (shaped * 0.5 * lfoDepth) + 0.5 + jitter * 0.01;
        const pan = Math.max(0, Math.min(1, panNormalized));

        const sample = (brown * 0.4 + pink * 0.5 + white * 0.3) * 0.5 * ampLfo;
        const leftGain = Math.cos(pan * Math.PI * 0.5);
        const rightGain = Math.sin(pan * Math.PI * 0.5);

        leftChannel[i] = sample * leftGain;
        rightChannel[i] = sample * rightGain;
      }
    }

    return audioBuffer;
  };

  // WAV to download (same as your implementation)
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

  // --- Presets and toggles ---
  const setPreset = (r, g, b) => {
    setRed(r); redRef.current = r;
    setGreen(g); greenRef.current = g;
    setBlue(b); blueRef.current = b;
  };

  const toggleOrganic = () => {
    setIsOrganic(prev => {
      isOrganicRef.current = !prev;
      return !prev;
    });
  };

  useEffect(() => {
    const saved = localStorage.getItem('rgbNoisePresets');
    if (saved) {
      try {
        setPresets(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  // --- Live-ref updates for controls so audio thread sees changes immediately ---
  useEffect(() => { redRef.current = red; }, [red]);
  useEffect(() => { greenRef.current = green; }, [green]);
  useEffect(() => { blueRef.current = blue; }, [blue]);
  useEffect(() => { isOrganicRef.current = isOrganic; }, [isOrganic]);

  useEffect(() => { lfoRateRef.current = lfoRate; }, [lfoRate]);
  useEffect(() => { lfoDepthRef.current = lfoDepth; }, [lfoDepth]);
  useEffect(() => { lfoShapeRef.current = lfoShape; }, [lfoShape]);
  useEffect(() => { randomnessRef.current = randomness; }, [randomness]);
  useEffect(() => { phaseOffsetRef.current = phaseOffset; }, [phaseOffset]);

  // --- UI ---
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
                setRed(val); redRef.current = val;
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
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setGreen(val); greenRef.current = val;
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
                const val = parseInt(e.target.value);
                setBlue(val); blueRef.current = val;
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

        {/* Custom Presets */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-400 mb-3">Custom Presets</label>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <div
                key={preset.id}
                className="relative group"
                onMouseEnter={() => setHoveredPresetId(preset.id)}
                onMouseLeave={() => setHoveredPresetId(null)}
              >
                <LoadPresetButton />
                {hoveredPresetId === preset.id && (
                    <DeletePresetButton />
                )}
              </div>
            ))}
            <SavePresetButton />
          </div>
        </div>

        {/* Organic/Pure Toggle */}
        <div className="mb-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div>
              <label className="text-sm font-medium text-white">
                {isOrganic ? '🌿 "Organic" Mode' : '🔬 Pure Mode'}
              </label>
              <p className="text-xs text-gray-400 mt-1">
                {isOrganic 
                  ? 'Multi-layered with subtle movement and spatial depth' 
                  : 'Raw mathematical algorithms, perfectly static'}
              </p>
            </div>
            <button
              onClick={toggleOrganic}
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

          {/* Organic controls (only visible in Organic Mode) */}
          {isOrganic && (
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-gray-400">LFO Rate (Hz) • {lfoRate.toFixed(3)}</label>
                <input
                  type="range"
                  min="0.02"
                  max="0.5"
                  step="0.005"
                  value={lfoRate}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setLfoRate(v); lfoRateRef.current = v;
                  }}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer mb-1"
                />
                <p className="text-xs text-gray-500">Lower = slower breathing (e.g. 0.125 = 8s cycle)</p>
              </div>

              <div>
                <label className="text-xs text-gray-400">LFO Depth (Pan) • {lfoDepth.toFixed(2)}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={lfoDepth}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setLfoDepth(v); lfoDepthRef.current = v;
                  }}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer mb-1"
                />
                <p className="text-xs text-gray-500">How wide pan swings are (0=center, 1=full sweep)</p>
              </div>

              <div>
                <label className="text-xs text-gray-400">Shape • {lfoShape}</label>
                <select
                  value={lfoShape}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLfoShape(v); lfoShapeRef.current = v;
                  }}
                  className="w-full bg-gray-700 text-white py-2 px-2 rounded-lg text-sm"
                >
                  <option value="sine">Sine (smooth)</option>
                  <option value="triangle">Triangle (linear)</option>
                  <option value="smoothstep">Smoothstep (natural)</option>
                  <option value="noiseBlend">Noise Blend (humanized)</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-400">Randomness • {randomness.toFixed(3)}</label>
                <input
                  type="range"
                  min="0"
                  max="0.2"
                  step="0.005"
                  value={randomness}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setRandomness(v); randomnessRef.current = v;
                  }}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer mb-1"
                />
                <p className="text-xs text-gray-500">Micro-variations to make movement feel alive</p>
              </div>

              <div>
                <label className="text-xs text-gray-400">Phase Offset • {phaseOffset.toFixed(2)}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={phaseOffset}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setPhaseOffset(v); phaseOffsetRef.current = v;
                    // update live LFO phase if running
                    if (organicStateRef.current) {
                      organicStateRef.current.lfoPhase = v * Math.PI * 2;
                    }
                  }}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer mb-1"
                />
                <p className="text-xs text-gray-500">Start position of the pan (0 = center, 0.25 = left, 0.75 = right)</p>
              </div>
            </div>
          )}
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
            <strong className="text-white">Real-time synthesis:</strong> Hit play and adjust the RGB sliders or Organic controls to hear changes immediately.
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
