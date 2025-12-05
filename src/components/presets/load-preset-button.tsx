import type { Preset } from '../../types'
import { usePresets } from '../../hooks/use-presets';

export default function LoadPresetButton({ preset } : { preset: Preset}) {

  const { loadPreset } = usePresets();
  
  return (
    <button
      onClick={() => loadPreset(preset)}
      className="w-12 h-12 rounded-lg shadow-lg border-2 border-gray-600 hover:border-white transition-colors"
      style={{ backgroundColor: rgbToHex(preset.red, preset.green, preset.blue) }}
      title={preset.name}
    />
  )
}