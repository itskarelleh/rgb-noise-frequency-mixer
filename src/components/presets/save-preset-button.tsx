import { Trash2 } from 'lucide-react';

export default function SavePresetButton() {

  return (
    <button
      onClick={savePreset}
      className="w-12 h-12 rounded-lg border-2 border-dashed border-green-500 hover:border-green-400 bg-transparent hover:bg-green-600 bg-opacity-10 hover:bg-opacity-20 transition-all flex items-center justify-center"
      title="Add new preset"
    >
      <Plus size={20} className="text-green-400" />
    </button>
  )
}