export function usePresets() {

    const savePreset = () => {
    const id = Date.now().toString();
    const noiseType = isOrganic ? lfoShape : 'pure';
    const newPreset: Preset = {
      id,
      name: `${getNoiseDescription()} (${noiseType})`,
      red,
      green,
      blue,
      isOrganic,
      lfoRate,
      lfoDepth,
      lfoShape,
      randomness,
      phaseOffset
    };

    const updatedPresets = [...presets, newPreset];
    setPresets(updatedPresets);
    localStorage.setItem('rgbNoisePresets', JSON.stringify(updatedPresets));
  };

  const loadPreset = (preset: Preset) => {
    setRed(preset.red);
    setGreen(preset.green);
    setBlue(preset.blue);
    setIsOrganic(preset.isOrganic);
    setLfoRate(preset.lfoRate);
    setLfoDepth(preset.lfoDepth);
    setLfoShape(preset.lfoShape);
    setRandomness(preset.randomness);
    setPhaseOffset(preset.phaseOffset);

    redRef.current = preset.red;
    greenRef.current = preset.green;
    blueRef.current = preset.blue;
    isOrganicRef.current = preset.isOrganic;
    lfoRateRef.current = preset.lfoRate;
    lfoDepthRef.current = preset.lfoDepth;
    lfoShapeRef.current = preset.lfoShape;
    randomnessRef.current = preset.randomness;
    phaseOffsetRef.current = preset.phaseOffset;
  };

  const deletePreset = (id: string) => {
    const updatedPresets = presets.filter(p => p.id !== id);
    setPresets(updatedPresets);
    localStorage.setItem('rgbNoisePresets', JSON.stringify(updatedPresets));
  };

  return {
    savePreset,
    loadPreset,
    deletePreset
  }
}