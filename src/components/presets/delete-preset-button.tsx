import { usePresets } from '../../hooks/use-presets'

export function DeletePresetButton({ id } : { id: string }) {

  return (
      <button
        onClick={() => deletePreset(preset.id)}
        className="absolute top-0 right-0 transform translate-x-1 -translate-y-1 bg-red-600 hover:bg-red-700 text-white p-1 rounded-full transition-colors"
      >
        <Trash2 size={12} />
      </button>
  )
}